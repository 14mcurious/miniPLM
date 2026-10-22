"""MiniPLM profile: self-service profile changes confirmed with an OTP.

A user can change their own email, password and name/surname. Every
change is two-step:
  1. change-* validates the request, sends a one-time code to the user's
     CURRENT mailbox (the OLD address when the email itself changes) and
     stages the change payload in Redis with a bounded TTL.
  2. confirm verifies the OTP and the re-sent payload, then applies it.

The confirming code always lands in the mailbox the user used to log in,
so a stolen session cannot reconfigure the login: the attacker does not
control that mailbox. When no SMTP transport is configured (Security
Settings page), the code is returned as demoOtp so the flow stays
testable, mirroring the login OTP behavior.

Identity is always derived from the validated Redis session, never from
the browser.
"""

import bcrypt
import json
import re
import time

import otp_email

NAME_MAX_LEN = 120
SPECIAL_CHAR_RE = re.compile(r"[^A-Za-z0-9]")
DEFAULT_MIN_PASSWORD_LENGTH = 12

PROFILE_SELECT = (
    'SELECT login_name, email, name, surname, company, notify_email'
    ' FROM "MiniPLM"."users" WHERE id = %s'
)


# --- Request / session / CSRF helpers (same contract as the other actions) -

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


def request_headers(args):
    headers = args.get("__ow_headers") or args.get("headers") or {}
    if not isinstance(headers, dict):
        return {}
    return {str(k).lower(): v for k, v in headers.items()}


def auth_token(args):
    headers = request_headers(args)
    value = str(headers.get("authorization") or "").strip()
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return value


def load_session(ctx, args):
    if not ctx or not hasattr(ctx, "REDIS"):
        return None
    token = auth_token(args)
    if not token:
        return None
    try:
        raw = ctx.REDIS.get(otp_email.redis_key(ctx, f"auth:sess:{token}"))
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
        return None
    return session


def require_session(ctx, args):
    session = load_session(ctx, args)
    if session is None:
        return None, {"ok": False, "error": "session"}
    return session, None


def require_csrf(ctx, args, session):
    expected = str(session.get("csrf") or "")
    sent = str(request_headers(args).get("x-csrf-token") or "").strip()
    if not expected or sent != expected:
        return False
    return True


def fail(key, **params):
    result = {"ok": False, "error": key}
    if params:
        result["errorParams"] = params
    return result


# --- Settings / policy (same values as the users action) --------------------

def get_security_policy(cur):
    def setting(key, default):
        cur.execute(
            "SELECT value FROM \"MiniPLM\".\"settings\" WHERE key = %s",
            (key,),
        )
        row = cur.fetchone()
        if not row:
            return default
        try:
            return int(row[0])
        except (TypeError, ValueError):
            return default

    def bool_setting(key, default):
        cur.execute(
            "SELECT value FROM \"MiniPLM\".\"settings\" WHERE key = %s",
            (key,),
        )
        row = cur.fetchone()
        if not row:
            return default
        return str(row[0]).strip().lower() == "true"

    return {
        "minPasswordLength": max(1, setting("min_password_length", DEFAULT_MIN_PASSWORD_LENGTH)),
        "requireUppercase": bool_setting("password_require_uppercase", True),
        "requireLowercase": bool_setting("password_require_lowercase", True),
        "requireDigit": bool_setting("password_require_digit", True),
        "requireSpecial": bool_setting("password_require_special", True),
    }


def validate_password(password, policy):
    """Return the i18n error key for an invalid password, or None."""
    if not password:
        return "users.error.passwordRequired"
    if len(password) < policy["minPasswordLength"]:
        return "users.error.passwordTooShort"
    if policy["requireSpecial"] and not SPECIAL_CHAR_RE.search(password):
        return "users.error.passwordSpecial"
    if policy["requireDigit"] and not re.search(r"\d", password):
        return "users.error.passwordDigit"
    if policy["requireUppercase"] and not re.search(r"[A-Z]", password):
        return "users.error.passwordUppercase"
    if policy["requireLowercase"] and not re.search(r"[a-z]", password):
        return "users.error.passwordLowercase"
    return None


def fetch_profile(cur, user_id):
    cur.execute(PROFILE_SELECT, (user_id,))
    row = cur.fetchone()
    if not row:
        return None
    (login_name, email, name, surname, company, notify_email) = row
    return {
        "loginName": login_name,
        "email": email,
        "name": name,
        "surname": surname,
        "company": company,
        "notifyEmail": bool(notify_email),
    }


# --- OTP delivery (demo mode mirrors the login flow) ------------------------

def deliver_otp(ctx, cur, user_id, kind, payload, subject, user_email):
    """Stage the change and deliver the code.

    Returns a success payload (delivery + optional demoOtp) or an error
    dict when the SMTP transport fails.
    """
    code, ttl = otp_email.issue_otp(ctx, cur, user_id, kind, payload)
    email_settings = otp_email.get_email_settings(cur)
    to_address = str(user_email or "").strip()
    if email_settings is None or not to_address:
        # Demo delivery: no SMTP transport configured (or no mailbox):
        # expose the code so the flow can be completed and tested.
        return {"ok": True, "delivery": "dev", "demoOtp": code, "email": to_address}
    try:
        otp_email.send_otp_email(email_settings, to_address, code, ttl, subject)
    except Exception as exc:
        print(f"[smtp] profile {kind} OTP to {to_address} failed: {exc}")
        return fail("profile.error.emailNotSent")
    return {"ok": True, "delivery": "email", "email": to_address}


# --- Operations --------------------------------------------------------------

def get_profile(ctx, args, session):
    user_id = session.get("userId")
    with ctx.POSTGRESQL.cursor() as cur:
        profile = fetch_profile(cur, user_id)
    if profile is None:
        return fail("profile.error.userNotFound")
    return {"ok": True, "user": profile}


def change_email(ctx, args, data, session):
    email = str(data.get("email") or "").strip()
    if not email or len(email) > otp_email.EMAIL_FIELD_MAX_LEN:
        return fail("profile.error.invalidEmail")
    if not otp_email.EMAIL_ADDRESS_RE.match(email):
        return fail("profile.error.invalidEmail")
    with ctx.POSTGRESQL.cursor() as cur:
        profile = fetch_profile(cur, session.get("userId"))
        if profile is None:
            return fail("profile.error.userNotFound")
        result = deliver_otp(
            ctx, cur, session.get("userId"),
            "email", {"email": email},
            "MiniPLM - one-time email change code",
            profile["email"],
        )
    if result.get("ok"):
        conn_commit(ctx)
    return result


def change_password(ctx, args, data, session):
    current = data.get("currentPassword")
    new_password = data.get("newPassword")
    verify = data.get("verifyPassword")
    if not current:
        return fail("profile.error.wrongCurrentPassword")
    if not new_password:
        return fail("users.error.passwordRequired")
    if verify is None or verify == "":
        return fail("users.error.verifyRequired")
    if new_password != verify:
        return fail("users.error.verifyMismatch")
    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT password_hash FROM "MiniPLM"."users" WHERE id = %s',
            (session.get("userId"),),
        )
        row = cur.fetchone()
        if not row:
            return fail("profile.error.userNotFound")
        stored_hash = row[0]
        try:
            if not bcrypt.checkpw(str(current).encode("utf-8"), str(stored_hash).encode("utf-8")):
                return fail("profile.error.wrongCurrentPassword")
            if bcrypt.checkpw(str(new_password).encode("utf-8"), str(stored_hash).encode("utf-8")):
                return fail("profile.error.passwordSame")
        except Exception:
            return fail("profile.error.wrongCurrentPassword")
        policy = get_security_policy(cur)
        error_key = validate_password(new_password, policy)
        if error_key:
            return fail(error_key)
        new_hash = bcrypt.hashpw(
            str(new_password).encode("utf-8"), bcrypt.gensalt(rounds=10)
        ).decode("utf-8")
        cur.execute(
            'SELECT email FROM "MiniPLM"."users" WHERE id = %s',
            (session.get("userId"),),
        )
        email_row = cur.fetchone()
        result = deliver_otp(
            ctx, cur, session.get("userId"),
            "password", {"hash": new_hash},
            "MiniPLM - one-time password change code",
            email_row[0] if email_row else "",
        )
    if result.get("ok"):
        conn_commit(ctx)
    return result


def change_name(ctx, args, data, session):
    name = str(data.get("name") or "").strip()
    surname = str(data.get("surname") or "").strip()
    if not name or not surname or len(name) > NAME_MAX_LEN or len(surname) > NAME_MAX_LEN:
        return fail("profile.error.invalidValue")
    with ctx.POSTGRESQL.cursor() as cur:
        profile = fetch_profile(cur, session.get("userId"))
        if profile is None:
            return fail("profile.error.userNotFound")
        result = deliver_otp(
            ctx, cur, session.get("userId"),
            "name", {"name": name, "surname": surname},
            "MiniPLM - one-time name change code",
            profile["email"],
        )
    if result.get("ok"):
        conn_commit(ctx)
    return result


def confirm(ctx, args, data, session):
    kind = str(data.get("kind") or "").strip().lower()
    if kind not in ("email", "password", "name"):
        return fail("profile.error.invalidRequest")
    ok, record = otp_email.consume_otp(ctx, session.get("userId"), data.get("otp"))
    if not ok:
        return fail("profile.error.otpInvalid")
    if not isinstance(record, dict) or record.get("kind") != kind:
        return fail("profile.error.invalidRequest")
    staged = record.get("payload") or {}
    conn = ctx.POSTGRESQL
    user_id = session.get("userId")

    if kind == "email":
        email = str(data.get("email") or "").strip()
        if email != str(staged.get("email") or ""):
            return fail("profile.error.invalidRequest")
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "MiniPLM"."users" SET email = %s, updated_at = now()'
                " WHERE id = %s",
                (email, user_id),
            )
            profile = fetch_profile(cur, user_id)
    elif kind == "password":
        new_password = data.get("newPassword")
        try:
            match = bcrypt.checkpw(
                str(new_password or "").encode("utf-8"),
                str(staged.get("hash") or "").encode("utf-8"),
            )
        except Exception:
            match = False
        if not match:
            return fail("profile.error.passwordMismatch")
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "MiniPLM"."users" SET password_hash = %s, updated_at = now()'
                " WHERE id = %s",
                (str(staged.get("hash")), user_id),
            )
            profile = fetch_profile(cur, user_id)
    else:  # name
        name = str(data.get("name") or "").strip()
        surname = str(data.get("surname") or "").strip()
        if name != str(staged.get("name") or "") or surname != str(staged.get("surname") or ""):
            return fail("profile.error.invalidRequest")
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "MiniPLM"."users" SET name = %s, surname = %s, updated_at = now()'
                " WHERE id = %s",
                (name, surname, user_id),
            )
            profile = fetch_profile(cur, user_id)

    conn.commit()
    return {"ok": True, "user": profile}


def cancel(ctx, args, data, session):
    key = otp_email.redis_key(ctx, f"profile:otp:{session.get('userId')}")
    try:
        ctx.REDIS.delete(key)
    except Exception:
        pass
    return {"ok": True}


def conn_commit(ctx):
    """No-op commit: deliver_otp only reads; staging writes are Redis-only."""
    return None


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Profile not configured"}

    method = request_method(args)
    data = request_data(args)

    session, error = require_session(ctx, args)
    if error is not None:
        return error

    try:
        if method == "GET":
            return get_profile(ctx, args, session)

        operation = str(data.get("operation") or "").strip().lower()
        mutating = operation in (
            "change-email", "changeemail",
            "change-password", "changepassword",
            "change-name", "changename",
            "confirm", "cancel",
        )
        if mutating and not require_csrf(ctx, args, session):
            return fail("csrf")
        if operation in ("change-email", "changeemail"):
            return change_email(ctx, args, data, session)
        if operation in ("change-password", "changepassword"):
            return change_password(ctx, args, data, session)
        if operation in ("change-name", "changename"):
            return change_name(ctx, args, data, session)
        if operation == "confirm":
            return confirm(ctx, args, data, session)
        if operation == "cancel":
            return cancel(ctx, args, data, session)
        return fail("profile.error.invalidRequest")
    except Exception as exc:
        try:
            ctx.POSTGRESQL.rollback()
        except Exception:
            pass
        return fail("profile.error.request", detail=str(exc))
