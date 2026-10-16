import bcrypt
import json
import re

DEFAULT_MIN_PASSWORD_LENGTH = 12
LOGIN_NAME_RE = re.compile(r"^[A-Za-z0-9]+$")
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


def validate_password(password, min_length):
    """Return the i18n error key for an invalid password, or None."""
    if not password:
        return "users.error.passwordRequired"
    if len(password) < min_length:
        return "users.error.passwordTooShort"
    if not SPECIAL_CHAR_RE.search(password):
        return "users.error.passwordSpecial"
    if not re.search(r"\d", password):
        return "users.error.passwordDigit"
    if not re.search(r"[A-Z]", password):
        return "users.error.passwordUppercase"
    if not re.search(r"[a-z]", password):
        return "users.error.passwordLowercase"
    return None


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
    " gp.project_name, p.id AS project_id"
    ' FROM "MiniPLM"."users" u'
    ' LEFT JOIN "MiniPLM"."user_groups" ug ON ug.user_id = u.id'
    ' LEFT JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
    ' LEFT JOIN "MiniPLM"."group_projects" gp ON gp.group_id = g.id'
    ' LEFT JOIN "MiniPLM"."projects" p ON p.name = gp.project_name'
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

    if not login_name:
        return fail("users.error.loginNameRequired")
    if not LOGIN_NAME_RE.match(login_name):
        return fail("users.error.loginNameFormat")
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
        min_length = get_min_password_length(cur)
        password_error = validate_password(password, min_length)
        if password_error:
            if password_error == "users.error.passwordTooShort":
                return fail(password_error, min=min_length)
            return fail(password_error)

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
            f'SELECT {USER_COLUMNS} FROM "MiniPLM"."users" WHERE id = %s',
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("users.error.userNotFound")
        cur.execute(
            'UPDATE "MiniPLM"."users" SET is_disabled = %s, updated_at = now()'
            " WHERE id = %s",
            (data.get("disabled", True), user_id),
        )
        cur.execute(
            f'SELECT {USER_COLUMNS} FROM "MiniPLM"."users" WHERE id = %s',
            (user_id,),
        )
        row = cur.fetchone()
    conn.commit()
    return {"ok": True, "user": user_to_dict(row)}


def change_password(conn, data, resource_name):
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
        if not cur.fetchone():
            return fail("users.error.userNotFound")
        min_length = get_min_password_length(cur)
        password_error = validate_password(password, min_length)
        if password_error:
            if password_error == "users.error.passwordTooShort":
                return fail(password_error, min=min_length)
            return fail(password_error)
        password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=10)
        ).decode("utf-8")
        cur.execute(
            'UPDATE "MiniPLM"."users" SET password_hash = %s, updated_at = now()'
            " WHERE id = %s",
            (password_hash, user_id),
        )
        cur.execute(
            f'SELECT {USER_COLUMNS} FROM "MiniPLM"."users" WHERE id = %s',
            (user_id,),
        )
        row = cur.fetchone()
    conn.commit()
    return {"ok": True, "user": user_to_dict(row)}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL"):
        return {"ok": False, "error": "Database not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    try:
        if method == "GET":
            with conn.cursor() as cur:
                min_length = get_min_password_length(cur)
            return {"ok": True, "minPasswordLength": min_length}

        operation = str(data.get("operation") or "").strip().lower()
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
            return change_password(conn, data, "user")
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
