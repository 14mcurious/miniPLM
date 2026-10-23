import bcrypt
import json
import re
import secrets
import time

import otp_email

DEFAULT_MIN_PASSWORD_LENGTH = 12
DEFAULT_LOGIN_NAME_MIN_LENGTH = 3
DEFAULT_LOGIN_NAME_MAX_LENGTH = 32
LOGIN_NAME_RE = re.compile(r"^[A-Za-z0-9]+$")
LOGIN_NAME_EXTENDED_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SPECIAL_CHAR_RE = re.compile(r"[^A-Za-z0-9]")

USER_COLUMNS = (
    "id, login_name, email, name, surname, company, "
    "notify_email, is_disabled"
)


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


def request_route_id(args, data, resource_name):
    for key in ("id", f"{resource_name}_id"):
        value = data.get(key)
        if value not in (None, ""):
            return str(value)
    raw_path = str(args.get("__ow_path") or args.get("path") or "").strip("/")
    if not raw_path:
        return ""
    parts = [part for part in raw_path.split("/") if part]
    if resource_name in parts:
        index = parts.index(resource_name)
        if index + 1 < len(parts):
            return parts[index + 1]
    return parts[-1] if parts else ""


def fail(key, **params):
    result = {"ok": False, "error": key}
    if params:
        result["errorParams"] = params
    return result


# --- Session / role / CSRF guards (Redis-backed opaque sessions) -----------
#
# Every Redis key is built from the generated ctx.REDIS_PREFIX plus an
# app-local suffix, as required by the Nuvolaris Redis ACL.

SYSADMIN_GROUP = "SysAdmin"


def redis_key(ctx, name):
    return f"{getattr(ctx, 'REDIS_PREFIX', '') or ''}{name}"


def request_headers(args):
    headers = args.get("__ow_headers") or args.get("headers") or {}
    if not isinstance(headers, dict):
        return {}
    return {str(k).lower(): v for k, v in headers.items()}


def auth_token(args):
    """Opaque session token from the Authorization header."""
    headers = request_headers(args)
    value = str(headers.get("authorization") or "").strip()
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return value


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


def get_min_password_length(cur):
    cur.execute(
        "SELECT value FROM \"MiniPLM\".\"settings\" WHERE key = %s",
        ("min_password_length",),
    )
    row = cur.fetchone()
    if row:
        try:
            return max(1, int(row[0]))
        except (TypeError, ValueError):
            pass
    return DEFAULT_MIN_PASSWORD_LENGTH


def get_bool_setting(cur, key, default):
    cur.execute(
        "SELECT value FROM \"MiniPLM\".\"settings\" WHERE key = %s",
        (key,),
    )
    row = cur.fetchone()
    if row:
        return str(row[0]).strip().lower() == "true"
    return default


def get_int_setting(cur, key, default, minimum=1, maximum=64):
    cur.execute(
        "SELECT value FROM \"MiniPLM\".\"settings\" WHERE key = %s",
        (key,),
    )
    row = cur.fetchone()
    if row:
        try:
            return min(maximum, max(minimum, int(row[0])))
        except (TypeError, ValueError):
            pass
    return default


def get_security_policy(cur):
    """Administrator-configurable login/password policy (Security Settings)."""
    return {
        "minPasswordLength": get_min_password_length(cur),
        "requireUppercase": get_bool_setting(
            cur, "password_require_uppercase", True
        ),
        "requireLowercase": get_bool_setting(
            cur, "password_require_lowercase", True
        ),
        "requireDigit": get_bool_setting(cur, "password_require_digit", True),
        "requireSpecial": get_bool_setting(cur, "password_require_special", True),
        "loginNameAlnumOnly": get_bool_setting(
            cur, "login_name_alnum_only", True
        ),
        "loginNameMinLength": get_int_setting(
            cur,
            "login_name_min_length",
            DEFAULT_LOGIN_NAME_MIN_LENGTH,
            minimum=1,
            maximum=64,
        ),
        "loginNameMaxLength": get_int_setting(
            cur,
            "login_name_max_length",
            DEFAULT_LOGIN_NAME_MAX_LENGTH,
            minimum=1,
            maximum=64,
        ),
    }


def validate_password(password, policy):
    """Return the i18n error key for an invalid password, or None."""
    if not password:
        return "users.error.passwordRequired", None
    if len(password) < policy["minPasswordLength"]:
        return "users.error.passwordTooShort", {"min": policy["minPasswordLength"]}
    if policy["requireSpecial"] and not SPECIAL_CHAR_RE.search(password):
        return "users.error.passwordSpecial", None
    if policy["requireDigit"] and not re.search(r"\d", password):
        return "users.error.passwordDigit", None
    if policy["requireUppercase"] and not re.search(r"[A-Z]", password):
        return "users.error.passwordUppercase", None
    if policy["requireLowercase"] and not re.search(r"[a-z]", password):
        return "users.error.passwordLowercase", None
    return None, None


def validate_login_name(login_name, policy):
    """Return (i18n error key, params) for an invalid login name, or (None, None)."""
    if not login_name:
        return "users.error.loginNameRequired", None
    if len(login_name) < policy["loginNameMinLength"]:
        return "users.error.loginNameTooShort", {"min": policy["loginNameMinLength"]}
    if len(login_name) > policy["loginNameMaxLength"]:
        return "users.error.loginNameTooLong", {"max": policy["loginNameMaxLength"]}
    pattern = LOGIN_NAME_RE if policy["loginNameAlnumOnly"] else LOGIN_NAME_EXTENDED_RE
    if not pattern.match(login_name):
        if policy["loginNameAlnumOnly"]:
            return "users.error.loginNameFormat", None
        return "users.error.loginNameFormatExtended", None
    return None, None


def user_to_dict(row):
    (user_id, login_name, email, name, surname, company, notify_email, is_disabled) = row
    return {
        "id": user_id,
        "loginName": login_name,
        "email": email,
        "name": name,
        "surname": surname,
        "company": company,
        "notifyEmail": bool(notify_email),
        "isDisabled": bool(is_disabled),
    }


def fetch_groups(cur, user_id):
    cur.execute(
        'SELECT g.name, gp.project_name, g.access_mode'
        ' FROM "MiniPLM"."user_groups" ug'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        ' LEFT JOIN "MiniPLM"."group_projects" gp ON gp.group_id = g.id'
        ' WHERE ug.user_id = %s'
        " ORDER BY g.name, COALESCE(gp.project_name, '')",
        (user_id,),
    )
    groups = {}
    for group_name, project_name, access_mode in cur.fetchall():
        entry = groups.setdefault(
            group_name,
            {"name": group_name, "projects": [], "accessMode": access_mode},
        )
        if project_name is not None:
            entry["projects"].append(project_name)
    return list(groups.values())


USER_JOIN_SELECT = (
    "SELECT u.id, u.login_name, u.email, u.name, u.surname, u.company,"
    " u.notify_email, u.is_disabled,"
    " g.id AS group_id, g.name AS group_name, g.access_mode AS group_access_mode,"
    " gp.project_name, p.id AS project_id,"
    " r.id AS role_id, r.name AS role_name"
    ' FROM "MiniPLM"."users" u'
    ' LEFT JOIN "MiniPLM"."user_groups" ug ON ug.user_id = u.id'
    ' LEFT JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
    ' LEFT JOIN "MiniPLM"."group_projects" gp ON gp.group_id = g.id'
    ' LEFT JOIN "MiniPLM"."projects" p ON p.name = gp.project_name'
    ' LEFT JOIN "MiniPLM"."user_roles" ur ON ur.user_id = u.id'
    ' LEFT JOIN "MiniPLM"."roles" r ON r.id = ur.role_id'
)


def fetch_users(cur, user_id=None):
    """Aggregate users with their groups and projects.

    One entry per user, sorted by login name; groups sorted by name; the
    user's project list is the de-duplicated union of the projects attached
    to the user's groups (project ids are returned for page navigation).
    """
    query = USER_JOIN_SELECT
    if user_id is not None:
        query += " WHERE u.id = %s"
    query += " ORDER BY u.id, g.name, p.id"
    cur.execute(query, (user_id,) if user_id is not None else ())
    users = {}
    for row in cur.fetchall():
        (
            uid, login_name, email, name, surname, company,
            notify_email, is_disabled,
            group_id, group_name, access_mode, project_name, project_id,
            role_id, role_name,
        ) = row
        entry = users.setdefault(
            uid,
            {
                "id": uid,
                "loginName": login_name,
                "email": email,
                "name": name,
                "surname": surname,
                "company": company,
                "notifyEmail": bool(notify_email),
                "isDisabled": bool(is_disabled),
                "_groups": {},
                "_projects": {},
                "_roles": {},
            },
        )
        if group_id is not None:
            group = entry["_groups"].setdefault(
                group_id,
                {
                    "id": group_id,
                    "name": group_name,
                    "accessMode": access_mode,
                    "_projects": {},
                },
            )
            if project_id is not None and project_name is not None:
                project = {"id": project_id, "name": project_name}
                group["_projects"][project_id] = project
                entry["_projects"][project_id] = project
        if role_id is not None:
            entry["_roles"][role_id] = {"id": role_id, "name": role_name}

    result = []
    for uid in sorted(users, key=lambda u: users[u]["loginName"].lower()):
        entry = users[uid]
        groups = []
        for gid in sorted(entry["_groups"], key=lambda g: entry["_groups"][g]["name"].lower()):
            group = entry["_groups"][gid]
            group_projects = sorted(
                (group["_projects"][pid] for pid in group["_projects"]),
                key=lambda p: p["name"].lower(),
            )
            groups.append(
                {
                    "id": group["id"],
                    "name": group["name"],
                    "accessMode": group["accessMode"],
                    "projects": group_projects,
                }
            )
        projects = sorted(
            (entry["_projects"][pid] for pid in entry["_projects"]),
            key=lambda p: p["name"].lower(),
        )
        roles = sorted(
            (entry["_roles"][rid] for rid in entry["_roles"]),
            key=lambda r: r["name"].lower(),
        )
        result.append(
            {
                "id": entry["id"],
                "loginName": entry["loginName"],
                "email": entry["email"],
                "name": entry["name"],
                "surname": entry["surname"],
                "company": entry["company"],
                "notifyEmail": entry["notifyEmail"],
                "isDisabled": entry["isDisabled"],
                "groups": groups,
                "projects": projects,
                "roles": roles,
            }
        )
    return result


def list_users(conn):
    with conn.cursor() as cur:
        users = fetch_users(cur)
    return {
        "ok": True,
        "users": [
            {
                "id": u["id"],
                "loginName": u["loginName"],
                "isDisabled": u["isDisabled"],
                "groups": u["groups"],
                "projects": u["projects"],
                "roles": u["roles"],
            }
            for u in users
        ],
    }


def get_user(conn, data):
    raw_id = data.get("id")
    try:
        user_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("users.error.userNotFound")
    with conn.cursor() as cur:
        users = fetch_users(cur, user_id)
    if not users:
        return fail("users.error.userNotFound")
    return {"ok": True, "user": users[0]}


def create_user(conn, data):
    login_name = str(data.get("loginName") or data.get("login_name") or "").strip()
    password = data.get("password")
    verify = data.get("verifyPassword")
    email = str(data.get("email") or "").strip()
    name = str(data.get("name") or "").strip()
    surname = str(data.get("surname") or "").strip()
    company = data.get("company")
    company = str(company).strip() if company not in (None, "") else None
    notify_email = bool(data.get("notifyEmail", data.get("notify_email", False)))

    if not email:
        return fail("users.error.emailRequired")
    if not name:
        return fail("users.error.nameRequired")
    if not surname:
        return fail("users.error.surnameRequired")
    if password is None or password == "":
        return fail("users.error.passwordRequired")
    if verify is None or verify == "":
        return fail("users.error.verifyRequired")
    if password != verify:
        return fail("users.error.verifyMismatch")

    with conn.cursor() as cur:
        policy = get_security_policy(cur)
        error_key, error_params = validate_login_name(login_name, policy)
        if error_key:
            return fail(error_key, **(error_params or {}))
        password_error, error_params = validate_password(password, policy)
        if password_error:
            return fail(password_error, **(error_params or {}))

        cur.execute(
            "SELECT 1 FROM \"MiniPLM\".\"users\" WHERE login_name = %s",
            (login_name,),
        )
        if cur.fetchone():
            return fail("users.error.loginNameTaken")

        password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=10)
        ).decode("utf-8")
        cur.execute(
            'INSERT INTO "MiniPLM"."users"'
            " (login_name, password_hash, email, name, surname, company,"
            "  notify_email, is_disabled)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE)",
            (
                login_name,
                password_hash,
                email,
                name,
                surname,
                company,
                notify_email,
            ),
        )
        user_id = cur.lastrowid if hasattr(cur, "lastrowid") else None
        if user_id is None:
            cur.execute(
                'SELECT id FROM "MiniPLM"."users" WHERE login_name = %s',
                (login_name,),
            )
            row = cur.fetchone()
            user_id = row[0] if row else None
    conn.commit()

    with conn.cursor() as cur:
        cur.execute(
            f'SELECT {USER_COLUMNS} FROM "MiniPLM"."users" WHERE id = %s',
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("users.error.userNotFound")
        user = user_to_dict(row)
        user["groups"] = fetch_groups(cur, user_id)
    return {"ok": True, "user": user}


def set_disabled(conn, data, resource_name):
    user_id = request_route_id(data if isinstance(data, dict) else {}, data, resource_name)
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return fail("users.error.userNotFound")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM \"MiniPLM\".\"users\" WHERE id = %s",
            (user_id,),
        )
        if cur.fetchone() is None:
            return fail("users.error.userNotFound")
        cur.execute(
            'UPDATE "MiniPLM"."users" SET is_disabled = %s, updated_at = now()'
            " WHERE id = %s",
            (data.get("disabled", True), user_id),
        )
        users = fetch_users(cur, user_id)
    conn.commit()
    if not users:
        return fail("users.error.userNotFound")
    # Return the full aggregated user (groups, projects, roles) so the
    # front end can replace its current user object without losing the
    # related collections.
    return {"ok": True, "user": users[0]}


def change_password(conn, data, ctx, resource_name):
    """Stage an admin-initiated password change (OTP confirmation).

    The administrator does NOT know the user's current password (the
    whole point of this flow: the user forgot it). The new password is
    validated, a one-time code is sent to the user's CURRENT email and
    the hashed new password is staged in Redis. The change is applied
    only by ``confirm-change-password`` with the right code.
    """
    user_id = request_route_id(data if isinstance(data, dict) else {}, data, resource_name)
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return fail("users.error.userNotFound")
    password = data.get("password")
    if not password:
        return fail("users.error.passwordRequired")
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT {USER_COLUMNS} FROM "MiniPLM"."users" WHERE id = %s',
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("users.error.userNotFound")
        user = user_to_dict(row)
        policy = get_security_policy(cur)
        password_error, error_params = validate_password(password, policy)
        if password_error:
            return fail(password_error, **(error_params or {}))
        password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=10)
        ).decode("utf-8")
        code, ttl = otp_email.issue_otp(ctx, cur, user_id, password_hash)
        email_settings = otp_email.get_email_settings(cur)

    to_address = str(user["email"] or "").strip()
    if email_settings is None or not to_address:
        # Demo delivery: no SMTP transport configured (or no mailbox):
        # expose the code so the flow can be completed and tested.
        return {
            "ok": True,
            "delivery": "dev",
            "demoOtp": code,
            "email": to_address,
        }
    try:
        otp_email.send_otp_email(
            email_settings,
            to_address,
            code,
            ttl,
            "MiniPLM - one-time password confirmation code",
        )
    except Exception as exc:
        print(f"[smtp] admin password OTP to {to_address} failed: {exc}")
        return fail("profile.error.emailNotSent")
    return {"ok": True, "delivery": "email", "email": to_address}


def confirm_change_password(conn, data, ctx, resource_name):
    """Apply the staged admin password change after OTP verification.

    The re-sent password is checked against the hash staged at
    ``change-password`` time (bcrypt check, constant-time), so the code
    can only confirm the exact password the administrator proposed.
    """
    user_id = request_route_id(data if isinstance(data, dict) else {}, data, resource_name)
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return fail("users.error.userNotFound")
    password = data.get("password")
    if not password:
        return fail("users.error.passwordRequired")

    ok, staged_hash = otp_email.consume_otp(ctx, user_id, data.get("otp"))
    if not ok:
        return fail("profile.error.otpInvalid")
    try:
        match = bcrypt.checkpw(
            password.encode("utf-8"), str(staged_hash or "").encode("utf-8")
        )
    except Exception:
        match = False
    if not match:
        return fail("profile.error.passwordMismatch")
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT {USER_COLUMNS} FROM "MiniPLM"."users" WHERE id = %s',
            (user_id,),
        )
        if not cur.fetchone():
            return fail("users.error.userNotFound")
        cur.execute(
            'UPDATE "MiniPLM"."users" SET password_hash = %s, updated_at = now()'
            " WHERE id = %s",
            (str(staged_hash), user_id),
        )
        users = fetch_users(cur, user_id)
    conn.commit()
    if not users:
        return fail("users.error.userNotFound")
    # Return the full aggregated user (groups, projects, roles) so the
    # front end can replace its current user object without losing the
    # related collections.
    return {"ok": True, "user": users[0]}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Database not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    # The Administration area is reserved for SysAdmin members: every
    # request (read or write) needs a valid session and the admin role.
    session, error = require_session(ctx, args)
    if error is not None:
        return error
    with conn.cursor() as cur:
        if not user_is_sysadmin(cur, session.get("userId")):
            return fail("forbidden")

    try:
        if method == "GET":
            with conn.cursor() as cur:
                policy = get_security_policy(cur)
            return {"ok": True, **policy}

        operation = str(data.get("operation") or "").strip().lower()
        mutating = operation in (
            "create",
            "disable",
            "enable",
            "change-password",
            "changepassword",
            "confirm-change-password",
            "confirmchangepassword",
        )
        if mutating and not require_csrf(ctx, args, session):
            return fail("csrf")
        if operation in ("list", "list-users"):
            return list_users(conn)
        if operation in ("get", "get-user"):
            return get_user(conn, data)
        if operation == "create":
            return create_user(conn, data)
        if operation in ("disable", "enable"):
            data["disabled"] = operation == "disable"
            return set_disabled(conn, data, "user")
        if operation in ("change-password", "changepassword"):
            return change_password(conn, data, ctx, "user")
        if operation in ("confirm-change-password", "confirmchangepassword"):
            return confirm_change_password(conn, data, ctx, "user")
        return fail("users.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        message = str(exc)
        if "unique" in message.lower():
            return fail("users.error.loginNameTaken")
        return fail("users.error.request", detail=message)
