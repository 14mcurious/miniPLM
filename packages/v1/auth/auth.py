"""MiniPLM authentication: login name + password + email OTP.

Flow:
  1. ``login``       verify credentials, issue a short-lived OTP (sent by
                     email; with no email transport configured the code is
                     returned as ``demoOtp`` so the flow stays testable).
  2. ``verify-otp``  verify the OTP, create the opaque session (Redis,
                     configurable TTL) plus a CSRF token bound to the same
                     session. A user can hold only ONE active session: a new
                     login invalidates the previous session token.
  3. ``me``          session validation (used on every page load).
  4. ``extend``      extend the session (same token, same CSRF token, new
                     expiry = now + configured duration).
  5. ``logout``      delete the session and the per-user session mapping.

Every credential / OTP / group-membership failure returns the SAME message:
``wrong credentials`` (required by the security spec, also prevents user
enumeration).
"""

import bcrypt
import json
import re
import secrets
import smtplib
import time

from email.message import EmailMessage

WRONG_CREDENTIALS = "wrong credentials"
OTP_MAX_ATTEMPTS = 5
SYSADMIN_GROUP = "SysAdmin"

# SMTP transport for the real OTP email delivery (Security Settings page).
SMTP_TIMEOUT_SECONDS = 15
EMAIL_FIELD_MAX_LEN = 255
EMAIL_ADDRESS_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Administrator-configurable security policy bounds (Security Settings page).
MIN_PASSWORD_LENGTH_MIN = 1
MIN_PASSWORD_LENGTH_MAX = 64
LOGIN_NAME_LENGTH_MIN = 1
LOGIN_NAME_LENGTH_MAX = 64
DEFAULT_LOGIN_NAME_MIN_LENGTH = 3
DEFAULT_LOGIN_NAME_MAX_LENGTH = 32

USER_SELECT = (
    "SELECT id, login_name, password_hash, email, name, surname, company,"
    " notify_email, is_disabled FROM \"MiniPLM\".\"users\" WHERE login_name = %s"
)

# --- Redis helpers (opaque sessions, OTP, single-session mapping) ---------
#
# Every key is built from the generated ctx.REDIS_PREFIX plus an app-local
# suffix, as required by the Nuvolaris Redis ACL.
#
#   auth:otp:{loginName}   {"code", "expiresAt", "attempts"} (TTL-bound)
#   auth:sess:{token}      {"userId", "loginName", "csrf", "expiresAt"}
#   auth:sessuser:{userId} current active session token


def redis_key(ctx, name):
    return f"{getattr(ctx, 'REDIS_PREFIX', '') or ''}{name}"


def request_headers(args):
    headers = args.get("__ow_headers") or args.get("headers") or {}
    if not isinstance(headers, dict):
        return {}
    return {str(k).lower(): v for k, v in headers.items()}


def auth_token(args):
    """Opaque session token from the Authorization header (or body)."""
    headers = request_headers(args)
    value = str(headers.get("authorization") or "").strip()
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    if value:
        return value
    body = args.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}
    if isinstance(body, dict) and body.get("token"):
        return str(body.get("token"))
    return ""


def get_setting(cur, key, default):
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        (key,),
    )
    row = cur.fetchone()
    if row:
        try:
            return int(row[0])
        except (TypeError, ValueError):
            pass
    return default


def get_bool_setting(cur, key, default):
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        (key,),
    )
    row = cur.fetchone()
    if row:
        return str(row[0]).strip().lower() == "true"
    return default


def parse_bool(value):
    """Coerce a submitted boolean-ish value; return None when invalid."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return value == 1
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1"):
            return True
        if lowered in ("false", "0"):
            return False
    return None


def _setting_value(cur, key):
    """Raw string value of one settings row ("" when missing)."""
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        (key,),
    )
    row = cur.fetchone()
    if row is None:
        return ""
    return str(row[0] or "").strip()


def get_security_policy(cur):
    """Administrator-configurable login/password policy (Security Settings)."""
    return {
        "minPasswordLength": get_setting(cur, "min_password_length", 12),
        "requireUppercase": get_bool_setting(cur, "password_require_uppercase", True),
        "requireLowercase": get_bool_setting(cur, "password_require_lowercase", True),
        "requireDigit": get_bool_setting(cur, "password_require_digit", True),
        "requireSpecial": get_bool_setting(cur, "password_require_special", True),
        "loginNameAlnumOnly": get_bool_setting(cur, "login_name_alnum_only", True),
        "loginNameMinLength": get_setting(
            cur, "login_name_min_length", DEFAULT_LOGIN_NAME_MIN_LENGTH
        ),
        "loginNameMaxLength": get_setting(
            cur, "login_name_max_length", DEFAULT_LOGIN_NAME_MAX_LENGTH
        ),
    }


def session_duration_seconds(cur):
    return max(60, get_setting(cur, "session_duration_hours", 6) * 3600)


def session_warning_seconds(cur):
    return max(60, get_setting(cur, "session_warning_minutes", 10) * 60)


def load_session(ctx, args):
    """Validate the caller's session; return its record dict or None."""
    if not ctx or not hasattr(ctx, "REDIS"):
        return None
    token = auth_token(args)
    if not token:
        return None
    try:
        raw = ctx.REDIS.get(redis_key(ctx, f"auth:sess:{token}"))
    except Exception:
        return None
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    try:
        session = json.loads(raw)
    except Exception:
        return None
    if not isinstance(session, dict):
        return None
    try:
        expires_at = int(session.get("expiresAt") or 0)
    except (TypeError, ValueError):
        expires_at = 0
    if expires_at <= int(time.time()):
        # Expired: clean up the stale user mapping, then reject.
        try:
            ctx.REDIS.delete(redis_key(ctx, f"auth:sess:{token}"))
            uid = session.get("userId")
            if uid is not None:
                current = ctx.REDIS.get(
                    redis_key(ctx, f"auth:sessuser:{uid}")
                )
                if isinstance(current, bytes):
                    current = current.decode("utf-8", "replace")
                if current == token:
                    ctx.REDIS.delete(redis_key(ctx, f"auth:sessuser:{uid}"))
        except Exception:
            pass
        return None
    return session


def require_session(ctx, args):
    session = load_session(ctx, args)
    if session is None:
        return None, {"ok": False, "error": "session"}
    return session, None


def require_csrf(ctx, args, session):
    """CSRF token must match the one issued with this session."""
    expected = str(session.get("csrf") or "")
    sent = str(request_headers(args).get("x-csrf-token") or "").strip()
    if not expected or sent != expected:
        return False
    return True


def user_is_sysadmin(cur, user_id):
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."user_groups" ug'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.name = %s AND g.is_disabled = FALSE",
        (user_id, SYSADMIN_GROUP),
    )
    return cur.fetchone() is not None


def accessible_projects(cur, user_id):
    """Projects reachable through the user's enabled groups (deduplicated).

    Each area carries the union of the access modes granted by the user's
    enabled groups (C=create, R=read, U=update, D=delete) so the frontend
    can mirror the real permissions in the UI.
    """
    cur.execute(
        'SELECT DISTINCT p.id, p.name, g.access_mode FROM "MiniPLM"."projects" p'
        ' JOIN "MiniPLM"."group_projects" gp ON gp.project_name = p.name'
        ' JOIN "MiniPLM"."user_groups" ug ON ug.group_id = gp.group_id'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.is_disabled = FALSE",
        (user_id,),
    )
    areas = {}
    for project_id, name, access_mode in cur.fetchall():
        entry = areas.setdefault(project_id, {"name": name, "modes": set()})
        entry["modes"].update(str(access_mode or ""))
    return [
        {"id": project_id, "name": areas[project_id]["name"],
         "modes": "".join(sorted(areas[project_id]["modes"]))}
        for project_id in sorted(
            areas, key=lambda pid: areas[pid]["name"]
        )
    ]


def user_has_enabled_group(cur, user_id):
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."user_groups" ug'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.is_disabled = FALSE LIMIT 1",
        (user_id,),
    )
    return cur.fetchone() is not None


def request_data(args):
    data = dict(args) if isinstance(args, dict) else {}
    body = data.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}
    merged = dict(body) if isinstance(body, dict) else {}
    ignored = {"body", "POSTGRES_URL", "__ow_method", "__ow_headers", "__ow_path"}
    merged.update({k: v for k, v in data.items() if k not in ignored})
    return merged


def request_method(args):
    return (args.get("__ow_method") or args.get("method") or "GET").upper()


def wrong():
    return {"ok": False, "error": WRONG_CREDENTIALS}


def fail(key, **params):
    result = {"ok": False, "error": key}
    if params:
        result["errorParams"] = params
    return result


def fetch_user(cur, login_name):
    cur.execute(USER_SELECT, (login_name,))
    row = cur.fetchone()
    if not row:
        return None
    (
        user_id,
        login,
        password_hash,
        email,
        name,
        surname,
        company,
        notify_email,
        is_disabled,
    ) = row
    return {
        "id": user_id,
        "loginName": login,
        "passwordHash": password_hash,
        "email": email,
        "name": name,
        "surname": surname,
        "company": company,
        "notifyEmail": bool(notify_email),
        "isDisabled": bool(is_disabled),
    }


def public_user(user):
    """User payload safe to send to the browser (no password hash)."""
    return {
        "id": user["id"],
        "loginName": user["loginName"],
        "email": user["email"],
        "name": user["name"],
        "surname": user["surname"],
        "company": user["company"],
    }


def get_email_settings(cur):
    """SMTP configuration for the real OTP email delivery.

    Returns None when the transport is not fully configured (missing
    host, port or sender address): login then falls back to the demo
    delivery (the code is returned to the UI as ``demoOtp``).
    """
    host = _setting_value(cur, "email_smtp_host")
    port_raw = _setting_value(cur, "email_smtp_port")
    from_address = _setting_value(cur, "email_from_address")
    if not host or not port_raw or not from_address:
        return None
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        return None
    if not 1 <= port <= 65535:
        return None
    return {
        "host": host,
        "port": port,
        "username": _setting_value(cur, "email_smtp_username"),
        "password": _setting_value(cur, "email_smtp_password"),
        "useTls": _setting_value(cur, "email_smtp_use_tls").lower() == "true",
        "from": from_address,
    }


def email_settings_payload(cur):
    """Email settings for the Security Settings page (never includes the
    SMTP password itself, only whether one is stored)."""
    host = _setting_value(cur, "email_smtp_host")
    from_address = _setting_value(cur, "email_from_address")
    port_raw = _setting_value(cur, "email_smtp_port")
    try:
        port = int(port_raw) if port_raw else None
    except (TypeError, ValueError):
        port = None
    configured = bool(host and port and from_address)
    return {
        "smtpHost": host,
        "smtpPort": port,
        "smtpUsername": _setting_value(cur, "email_smtp_username"),
        "useTls": _setting_value(cur, "email_smtp_use_tls").lower() == "true",
        "fromAddress": from_address,
        "passwordConfigured": bool(_setting_value(cur, "email_smtp_password")),
        "configured": configured,
    }


def send_otp_email(settings, to_address, code, ttl_seconds):
    """Send the OTP code to ``to_address`` through the configured SMTP.

    Raises on any transport failure; the caller maps it to the generic
    ``auth.error.emailNotSent`` result so infrastructure details never
    reach an unauthenticated caller.
    """
    msg = EmailMessage()
    msg["From"] = settings["from"]
    msg["To"] = to_address
    msg["Subject"] = "MiniPLM - one-time login code"
    minutes = max(1, ttl_seconds // 60)
    msg.set_content(
        "Your MiniPLM one-time login code is: "
        f"{code}\n\n"
        f"The code expires in about {minutes} minute(s).\n"
        "If you did not request this code, you can safely ignore this email.\n"
    )

    server = smtplib.SMTP(
        settings["host"], settings["port"], timeout=SMTP_TIMEOUT_SECONDS
    )
    try:
        if settings["useTls"]:
            server.starttls()
        if settings["username"]:
            server.login(settings["username"], settings["password"])
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def issue_otp(ctx, cur, login_name):
    ttl = max(60, get_setting(cur, "otp_ttl_seconds", 300))
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    now = int(time.time())
    record = json.dumps({"code": code, "expiresAt": now + ttl, "attempts": 0})
    ctx.REDIS.set(redis_key(ctx, f"auth:otp:{login_name}"), record, ex=ttl)
    return code, ttl


def consume_otp(ctx, data):
    """Verify the submitted OTP. Returns True on success, False otherwise."""
    login_name = str(data.get("loginName") or data.get("login_name") or "").strip()
    otp = str(data.get("otp") or "").strip()
    if not login_name or not otp:
        return False

    key = redis_key(ctx, f"auth:otp:{login_name}")
    try:
        raw = ctx.REDIS.get(key)
    except Exception:
        raw = None
    if raw is None:
        return False
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    try:
        record = json.loads(raw)
    except Exception:
        return False
    code = str(record.get("code") or "")
    expires_at = int(record.get("expiresAt") or 0)
    attempts = int(record.get("attempts") or 0)

    now = int(time.time())
    if expires_at <= now or attempts >= OTP_MAX_ATTEMPTS:
        try:
            ctx.REDIS.delete(key)
        except Exception:
            pass
        return False
    if secrets.compare_digest(code, otp):
        try:
            ctx.REDIS.delete(key)
        except Exception:
            pass
        return True

    attempts += 1
    if attempts >= OTP_MAX_ATTEMPTS:
        try:
            ctx.REDIS.delete(key)
        except Exception:
            pass
        return False
    try:
        remaining = max(1, expires_at - now)
        ctx.REDIS.set(
            key,
            json.dumps({"code": code, "expiresAt": expires_at, "attempts": attempts}),
            ex=remaining,
        )
    except Exception:
        pass
    return False


def create_session(ctx, cur, user):
    """Create the single active session for the user (+ bound CSRF token)."""
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    duration = session_duration_seconds(cur)
    expires_at = int(time.time()) + duration

    record = json.dumps(
        {
            "userId": user["id"],
            "loginName": user["loginName"],
            "csrf": csrf,
            "expiresAt": expires_at,
        }
    )

    # One session per user: invalidate any previous session token.
    user_key = redis_key(ctx, f"auth:sessuser:{user['id']}")
    previous = None
    try:
        previous = ctx.REDIS.get(user_key)
    except Exception:
        previous = None
    if isinstance(previous, bytes):
        previous = previous.decode("utf-8", "replace")
    if previous and previous != token:
        try:
            ctx.REDIS.delete(redis_key(ctx, f"auth:sess:{previous}"))
        except Exception:
            pass

    ctx.REDIS.set(redis_key(ctx, f"auth:sess:{token}"), record, ex=duration)
    ctx.REDIS.set(user_key, token, ex=duration)
    return token, csrf, expires_at


def do_login(ctx, cur, data):
    login_name = str(data.get("loginName") or data.get("login_name") or "").strip()
    password = data.get("password")
    if not login_name or not password:
        return wrong()

    user = fetch_user(cur, login_name)
    if user is None or user["isDisabled"]:
        return wrong()
    try:
        ok = bcrypt.checkpw(
            str(password).encode("utf-8"),
            user["passwordHash"].encode("utf-8"),
        )
    except Exception:
        ok = False
    if not ok:
        return wrong()

    code, ttl = issue_otp(ctx, cur, login_name)

    email_settings = get_email_settings(cur)
    if email_settings is None:
        # No email transport is configured in this environment: expose the
        # code so the OTP flow can be completed and tested (demo mode).
        return {
            "ok": True,
            "sent": True,
            "delivery": "dev",
            "demoOtp": code,
            "email": user["email"],
        }

    # Real delivery: the code goes to the user's mailbox, never to the UI.
    to_address = str(user["email"] or "").strip()
    if not to_address:
        return fail("auth.error.emailNotSent")
    try:
        send_otp_email(email_settings, to_address, code, ttl)
    except Exception as exc:
        print(f"[smtp] OTP email to {to_address} failed: {exc}")
        return fail("auth.error.emailNotSent")
    return {"ok": True, "sent": True, "delivery": "email", "email": to_address}


def do_verify_otp(ctx, args, data):
    if not consume_otp(ctx, data):
        return wrong()
    login_name = str(data.get("loginName") or data.get("login_name") or "").strip()

    with ctx.POSTGRESQL.cursor() as cur:
        user = fetch_user(cur, login_name)
        if user is None or user["isDisabled"]:
            return wrong()
        # A user without any (enabled) group is not allowed into the system.
        if not user_has_enabled_group(cur, user["id"]):
            return wrong()
        token, csrf, expires_at = create_session(ctx, cur, user)
        is_admin = user_is_sysadmin(cur, user["id"])
        work_areas = accessible_projects(cur, user["id"])
        warning_at = expires_at - session_warning_seconds(cur)

    return {
        "ok": True,
        "token": token,
        "csrfToken": csrf,
        "expiresAt": expires_at,
        "warningAt": warning_at,
        "user": public_user(user),
        "isAdmin": is_admin,
        "workAreas": work_areas,
    }


def do_me(ctx, args):
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    token = auth_token(args)
    expires_at = int(session.get("expiresAt") or 0)
    with ctx.POSTGRESQL.cursor() as cur:
        user = fetch_user(cur, session.get("loginName"))
        if user is None or user["isDisabled"]:
            # Account removed/disabled mid-session: kill the session.
            try:
                ctx.REDIS.delete(redis_key(ctx, f"auth:sess:{token}"))
                if user is not None:
                    ctx.REDIS.delete(
                        redis_key(ctx, f"auth:sessuser:{user['id']}")
                    )
            except Exception:
                pass
            return {"ok": False, "error": "session"}
        is_admin = user_is_sysadmin(cur, user["id"])
        work_areas = accessible_projects(cur, user["id"])
        warning_at = expires_at - session_warning_seconds(cur)

    return {
        "ok": True,
        "token": token,
        "csrfToken": str(session.get("csrf") or ""),
        "expiresAt": expires_at,
        "warningAt": warning_at,
        "user": public_user(user),
        "isAdmin": is_admin,
        "workAreas": work_areas,
    }


def do_extend(ctx, args):
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    if not require_csrf(ctx, args, session):
        return fail("csrf")
    with ctx.POSTGRESQL.cursor() as cur:
        user = fetch_user(cur, session.get("loginName"))
        if user is None or user["isDisabled"]:
            return {"ok": False, "error": "session"}
        duration = session_duration_seconds(cur)
    expires_at = int(time.time()) + duration
    session["expiresAt"] = expires_at
    token = auth_token(args)
    ctx.REDIS.set(
        redis_key(ctx, f"auth:sess:{token}"),
        json.dumps(session),
        ex=duration,
    )
    try:
        ctx.REDIS.expire(
            redis_key(ctx, f"auth:sessuser:{session.get('userId')}"), duration
        )
    except Exception:
        pass
    with ctx.POSTGRESQL.cursor() as cur:
        warning_at = expires_at - session_warning_seconds(cur)
    return {
        "ok": True,
        "expiresAt": expires_at,
        "warningAt": warning_at,
        "csrfToken": str(session.get("csrf") or ""),
    }


def do_logout(ctx, args):
    session, error = require_session(ctx, args)
    if error is not None:
        # Already expired / unknown session: nothing to do.
        return {"ok": True, "loggedOut": True}
    if not require_csrf(ctx, args, session):
        return fail("csrf")
    token = auth_token(args)
    try:
        ctx.REDIS.delete(redis_key(ctx, f"auth:sess:{token}"))
        user_key = redis_key(ctx, f"auth:sessuser:{session.get('userId')}")
        current = ctx.REDIS.get(user_key)
        if isinstance(current, bytes):
            current = current.decode("utf-8", "replace")
        if current == token:
            ctx.REDIS.delete(user_key)
    except Exception:
        pass
    return {"ok": True, "loggedOut": True}


def do_get_settings(ctx, args):
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    with ctx.POSTGRESQL.cursor() as cur:
        if not user_is_sysadmin(cur, session.get("userId")):
            return fail("forbidden")
        duration_hours = get_setting(cur, "session_duration_hours", 6)
        warning_minutes = get_setting(cur, "session_warning_minutes", 10)
        otp_ttl = get_setting(cur, "otp_ttl_seconds", 300)
        email_payload = email_settings_payload(cur)
        policy = get_security_policy(cur)
    return {
        "ok": True,
        "sessionDurationHours": duration_hours,
        "sessionWarningMinutes": warning_minutes,
        "otpTtlSeconds": otp_ttl,
        "email": email_payload,
        **policy,
    }


def do_update_email_settings(ctx, args, data):
    """Administrator-managed SMTP settings (Security Settings page).

    An empty host disables the email transport (all the other values are
    cleared and login falls back to the demo delivery). The API never
    returns the stored SMTP password: an empty submission keeps the
    previously stored one, while a non-empty one replaces it.
    """
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    if not require_csrf(ctx, args, session):
        return fail("csrf")

    host = str(data.get("smtpHost") or "").strip()
    from_address = str(data.get("fromAddress") or "").strip()
    username = str(data.get("smtpUsername") or "").strip()
    password = data.get("smtpPassword")
    password = str(password).strip() if password is not None else ""
    use_tls = parse_bool(data.get("useTls"))
    if use_tls is None:
        return fail("auth.error.invalidEmailSettings")

    if host:
        if (
            len(host) > EMAIL_FIELD_MAX_LEN
            or len(username) > EMAIL_FIELD_MAX_LEN
            or len(from_address) > EMAIL_FIELD_MAX_LEN
        ):
            return fail("auth.error.invalidEmailSettings")
        try:
            port = int(data.get("smtpPort"))
        except (TypeError, ValueError):
            return fail("auth.error.invalidEmailSettings")
        if not 1 <= port <= 65535:
            return fail("auth.error.invalidEmailSettings")
        if not EMAIL_ADDRESS_RE.match(from_address):
            return fail("auth.error.invalidEmailSettings")
    else:
        # Disabling the email transport: clear all the SMTP values.
        port = 0
        username = ""
        from_address = ""
        password = ""
        use_tls = False

    with ctx.POSTGRESQL.cursor() as cur:
        if not user_is_sysadmin(cur, session.get("userId")):
            return fail("forbidden")
        for key, value in (
            ("email_smtp_host", host),
            ("email_smtp_port", str(port)),
            ("email_smtp_username", username),
            ("email_smtp_use_tls", "true" if use_tls else "false"),
            ("email_from_address", from_address),
        ):
            cur.execute(
                'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
                " ON CONFLICT (key) DO UPDATE SET value = %s",
                (key, value, value),
            )
        if password:
            cur.execute(
                'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
                " ON CONFLICT (key) DO UPDATE SET value = %s",
                ("email_smtp_password", password, password),
            )
        elif not host:
            cur.execute(
                'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
                " ON CONFLICT (key) DO UPDATE SET value = %s",
                ("email_smtp_password", "", ""),
            )
    ctx.POSTGRESQL.commit()
    return {
        "ok": True,
        "configured": bool(host and port and from_address),
        "passwordUpdated": bool(password and host),
    }


def do_update_password_policy(ctx, args, data):
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    if not require_csrf(ctx, args, session):
        return fail("csrf")

    try:
        min_length = int(data.get("minPasswordLength"))
    except (TypeError, ValueError):
        return fail("auth.error.invalidPasswordPolicy")
    if min_length < MIN_PASSWORD_LENGTH_MIN or min_length > MIN_PASSWORD_LENGTH_MAX:
        return fail(
            "auth.error.invalidPasswordPolicy",
            min=MIN_PASSWORD_LENGTH_MIN,
            max=MIN_PASSWORD_LENGTH_MAX,
        )
    flags = {}
    for field, key in (
        ("requireUppercase", "password_require_uppercase"),
        ("requireLowercase", "password_require_lowercase"),
        ("requireDigit", "password_require_digit"),
        ("requireSpecial", "password_require_special"),
    ):
        value = parse_bool(data.get(field))
        if value is None:
            return fail("auth.error.invalidPasswordPolicy")
        flags[key] = value

    with ctx.POSTGRESQL.cursor() as cur:
        if not user_is_sysadmin(cur, session.get("userId")):
            return fail("forbidden")
        cur.execute(
            'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
            " ON CONFLICT (key) DO UPDATE SET value = %s",
            ("min_password_length", str(min_length), str(min_length)),
        )
        for key, value in flags.items():
            text = "true" if value else "false"
            cur.execute(
                'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
                " ON CONFLICT (key) DO UPDATE SET value = %s",
                (key, text, text),
            )
    ctx.POSTGRESQL.commit()
    return {
        "ok": True,
        "minPasswordLength": min_length,
        "requireUppercase": flags["password_require_uppercase"],
        "requireLowercase": flags["password_require_lowercase"],
        "requireDigit": flags["password_require_digit"],
        "requireSpecial": flags["password_require_special"],
    }


def do_update_login_policy(ctx, args, data):
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    if not require_csrf(ctx, args, session):
        return fail("csrf")

    alnum_only = parse_bool(data.get("loginNameAlnumOnly"))
    if alnum_only is None:
        return fail("auth.error.invalidLoginPolicy")
    try:
        min_length = int(data.get("loginNameMinLength"))
        max_length = int(data.get("loginNameMaxLength"))
    except (TypeError, ValueError):
        return fail("auth.error.invalidLoginPolicy")
    if (
        min_length < LOGIN_NAME_LENGTH_MIN
        or min_length > LOGIN_NAME_LENGTH_MAX
        or max_length < LOGIN_NAME_LENGTH_MIN
        or max_length > LOGIN_NAME_LENGTH_MAX
        or max_length < min_length
    ):
        return fail(
            "auth.error.invalidLoginPolicy",
            min=LOGIN_NAME_LENGTH_MIN,
            max=LOGIN_NAME_LENGTH_MAX,
        )

    with ctx.POSTGRESQL.cursor() as cur:
        if not user_is_sysadmin(cur, session.get("userId")):
            return fail("forbidden")
        for key, value in (
            ("login_name_alnum_only", "true" if alnum_only else "false"),
            ("login_name_min_length", str(min_length)),
            ("login_name_max_length", str(max_length)),
        ):
            cur.execute(
                'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
                " ON CONFLICT (key) DO UPDATE SET value = %s",
                (key, value, value),
            )
    ctx.POSTGRESQL.commit()
    return {
        "ok": True,
        "loginNameAlnumOnly": alnum_only,
        "loginNameMinLength": min_length,
        "loginNameMaxLength": max_length,
    }


def do_update_session_settings(ctx, args, data):
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    if not require_csrf(ctx, args, session):
        return fail("csrf")

    raw_hours = data.get("sessionDurationHours", data.get("session_duration_hours"))
    raw_warning = data.get("sessionWarningMinutes", data.get("session_warning_minutes"))
    try:
        hours = int(raw_hours)
        warning = int(raw_warning)
    except (TypeError, ValueError):
        return fail("auth.error.invalidValue")
    if hours < 1 or hours > 48:
        return fail("auth.error.invalidValue", max=48)
    if warning < 1 or warning >= hours * 60:
        return fail("auth.error.invalidValue", max=hours * 60 - 1)

    with ctx.POSTGRESQL.cursor() as cur:
        if not user_is_sysadmin(cur, session.get("userId")):
            return fail("forbidden")
        for key, value in (
            ("session_duration_hours", str(hours)),
            ("session_warning_minutes", str(warning)),
        ):
            cur.execute(
                'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
                " ON CONFLICT (key) DO UPDATE SET value = %s",
                (key, value, value),
            )
    ctx.POSTGRESQL.commit()
    return {
        "ok": True,
        "sessionDurationHours": hours,
        "sessionWarningMinutes": warning,
    }


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Authentication not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    try:
        if method == "GET":
            return fail("auth.error.request")

        operation = str(data.get("operation") or "").strip().lower()
        if operation == "login":
            with conn.cursor() as cur:
                return do_login(ctx, cur, data)
        if operation in ("verify-otp", "verifyotp", "verify"):
            return do_verify_otp(ctx, args, data)
        if operation in ("me", "session", "whoami"):
            return do_me(ctx, args)
        if operation == "extend":
            return do_extend(ctx, args)
        if operation == "logout":
            return do_logout(ctx, args)
        if operation in ("get-settings", "getsettings"):
            return do_get_settings(ctx, args)
        if operation in ("update-session-settings", "updatesettings"):
            return do_update_session_settings(ctx, args, data)
        if operation in ("update-email-settings", "updateemailsettings"):
            return do_update_email_settings(ctx, args, data)
        if operation in ("update-password-policy", "updatepasswordpolicy"):
            return do_update_password_policy(ctx, args, data)
        if operation in ("update-login-policy", "updateloginpolicy"):
            return do_update_login_policy(ctx, args, data)
        return fail("auth.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("auth.error.request", detail=str(exc))
