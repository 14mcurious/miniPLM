import json
import re
import time

MODE_ORDER = ("C", "R", "U", "D")
MODE_SET = frozenset(MODE_ORDER)


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


def group_to_dict(row):
    (group_id, name, access_mode, is_disabled, project_name, login_names) = row
    return {
        "id": group_id,
        "name": name,
        "accessMode": access_mode,
        "isDisabled": bool(is_disabled),
        "project": project_name,
        "users": [u for u in (login_names or "").split(",") if u],
    }


GROUP_BASE = (
    "SELECT g.id, g.name, g.access_mode, g.is_disabled,"
    " gp.project_name,"
    " (SELECT string_agg(u.login_name, ',' ORDER BY u.login_name)"
    '   FROM "MiniPLM"."user_groups" ug'
    '   JOIN "MiniPLM"."users" u ON u.id = ug.user_id'
    "   WHERE ug.group_id = g.id) AS login_names"
    ' FROM "MiniPLM"."groups" g'
    ' LEFT JOIN "MiniPLM"."group_projects" gp ON gp.group_id = g.id'
)


def fetch_groups(cur):
    cur.execute(f"{GROUP_BASE} ORDER BY g.id")
    return [group_to_dict(row) for row in cur.fetchall()]


def create_group(conn, data):
    raw_project_id = data.get("projectId", data.get("project_id"))
    try:
        project_id = int(raw_project_id)
    except (TypeError, ValueError):
        return fail("groups.error.projectRequired")

    raw_modes = data.get("accessModes", data.get("access_modes"))
    if isinstance(raw_modes, str):
        raw_modes = [part.strip() for part in raw_modes.split(",")]
    modes = []
    if isinstance(raw_modes, list):
        for item in raw_modes:
            letter = str(item).strip().upper()
            if len(letter) == 1 and letter in MODE_SET and letter not in modes:
                modes.append(letter)
    if not modes:
        return fail("groups.error.modesRequired")
    # Always stored/used in the fixed CRUD sequence, which makes the
    # derived group name deterministic and unique.
    modes = [letter for letter in MODE_ORDER if letter in modes]

    raw_users = data.get("loginNames", data.get("users"))
    if isinstance(raw_users, str):
        raw_users = [part.strip() for part in raw_users.split(",")]
    login_names = []
    if isinstance(raw_users, list):
        for item in raw_users:
            value = str(item).strip()
            if value and value not in login_names:
                login_names.append(value)
    if not login_names:
        return fail("groups.error.usersRequired")

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, identifier FROM \"MiniPLM\".\"projects\" WHERE id = %s",
            (project_id,),
        )
        project = cur.fetchone()
        if not project:
            return fail("groups.error.projectNotFound")
        _, project_name, project_identifier = project
        project_identifier = re.sub(r"\s+", "", project_identifier)

        cur.execute(
            "SELECT 1 FROM \"MiniPLM\".\"users\" WHERE login_name = %s",
            (login_names[0],),
        )
        # All login names must exist.
        placeholders = ",".join(["%s"] * len(login_names))
        cur.execute(
            f"SELECT COUNT(*) FROM \"MiniPLM\".\"users\" WHERE login_name IN ({placeholders})",
            tuple(login_names),
        )
        found = cur.fetchone()[0]
        if found != len(login_names):
            return fail("groups.error.userNotFound")

        group_name = f"{project_identifier}_{''.join(modes)}"
        cur.execute(
            "SELECT 1 FROM \"MiniPLM\".\"groups\" WHERE name = %s",
            (group_name,),
        )
        if cur.fetchone():
            return fail("groups.error.nameTaken")

        cur.execute(
            'INSERT INTO "MiniPLM"."groups" (name, access_mode, is_disabled)'
            " VALUES (%s, %s, FALSE)",
            (group_name, "".join(modes)),
        )
        group_id = cur.lastrowid if hasattr(cur, "lastrowid") else None
        if group_id is None:
            cur.execute(
                "SELECT id FROM \"MiniPLM\".\"groups\" WHERE name = %s",
                (group_name,),
            )
            row = cur.fetchone()
            group_id = row[0] if row else None

        cur.execute(
            'INSERT INTO "MiniPLM"."group_projects" (group_id, project_name)'
            " VALUES (%s, %s)",
            (group_id, project_name),
        )
        for login_name in login_names:
            cur.execute(
                "SELECT id FROM \"MiniPLM\".\"users\" WHERE login_name = %s",
                (login_name,),
            )
            user_row = cur.fetchone()
            if user_row:
                cur.execute(
                    "INSERT INTO \"MiniPLM\".\"user_groups\" (user_id, group_id)"
                    " VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (user_row[0], group_id),
                )

    conn.commit()

    with conn.cursor() as cur:
        cur.execute(f"{GROUP_BASE} WHERE g.id = %s ORDER BY g.id", (group_id,))
        row = cur.fetchone()
        if not row:
            return fail("groups.error.groupNotFound")
    return {"ok": True, "group": group_to_dict(row)}


def update_group(conn, data):
    """Edit a group: access modes and user membership.

    The group name is derived from the project identifier and the selected
    modes, so a mode change renames the group when the derived name changes.
    """
    raw_id = data.get("id")
    try:
        group_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("groups.error.groupNotFound")

    raw_modes = data.get("accessModes", data.get("access_modes"))
    if isinstance(raw_modes, str):
        raw_modes = [part.strip() for part in raw_modes.split(",")]
    modes = []
    if isinstance(raw_modes, list):
        for item in raw_modes:
            letter = str(item).strip().upper()
            if len(letter) == 1 and letter in MODE_SET and letter not in modes:
                modes.append(letter)
    if not modes:
        return fail("groups.error.modesRequired")
    modes = [letter for letter in MODE_ORDER if letter in modes]

    raw_users = data.get("loginNames", data.get("users"))
    if isinstance(raw_users, str):
        raw_users = [part.strip() for part in raw_users.split(",")]
    login_names = []
    if isinstance(raw_users, list):
        for item in raw_users:
            value = str(item).strip()
            if value and value not in login_names:
                login_names.append(value)
    if not login_names:
        return fail("groups.error.usersRequired")

    with conn.cursor() as cur:
        cur.execute(
            "SELECT g.id, g.name, g.access_mode, gp.project_name, p.identifier"
            ' FROM "MiniPLM"."groups" g'
            ' LEFT JOIN "MiniPLM"."group_projects" gp ON gp.group_id = g.id'
            ' LEFT JOIN "MiniPLM"."projects" p ON p.name = gp.project_name'
            " WHERE g.id = %s",
            (group_id,),
        )
        row = cur.fetchone()
        if not row or row[3] is None or row[4] is None:
            return fail("groups.error.groupNotFound")
        _, old_name, _, _, project_identifier = row
        project_identifier = re.sub(r"\s+", "", project_identifier)

        new_name = f"{project_identifier}_{''.join(modes)}"
        if new_name != old_name:
            cur.execute(
                "SELECT 1 FROM \"MiniPLM\".\"groups\" WHERE name = %s",
                (new_name,),
            )
            if cur.fetchone():
                return fail("groups.error.nameTaken")
            cur.execute(
                "UPDATE \"MiniPLM\".\"groups\" SET name = %s WHERE id = %s",
                (new_name, group_id),
            )

        cur.execute(
            "UPDATE \"MiniPLM\".\"groups\" SET access_mode = %s WHERE id = %s",
            ("".join(modes), group_id),
        )

        placeholders = ",".join(["%s"] * len(login_names))
        cur.execute(
            f"SELECT COUNT(*) FROM \"MiniPLM\".\"users\" WHERE login_name IN ({placeholders})",
            tuple(login_names),
        )
        found = cur.fetchone()[0]
        if found != len(login_names):
            return fail("groups.error.userNotFound")

        cur.execute(
            "DELETE FROM \"MiniPLM\".\"user_groups\" WHERE group_id = %s",
            (group_id,),
        )
        for login_name in login_names:
            cur.execute(
                "SELECT id FROM \"MiniPLM\".\"users\" WHERE login_name = %s",
                (login_name,),
            )
            user_row = cur.fetchone()
            if user_row:
                cur.execute(
                    "INSERT INTO \"MiniPLM\".\"user_groups\" (user_id, group_id)"
                    " VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (user_row[0], group_id),
                )

    conn.commit()

    with conn.cursor() as cur:
        cur.execute(f"{GROUP_BASE} WHERE g.id = %s ORDER BY g.id", (group_id,))
        row = cur.fetchone()
        if not row:
            return fail("groups.error.groupNotFound")
    return {"ok": True, "group": group_to_dict(row)}


def set_disabled(conn, data):
    raw_id = data.get("id")
    try:
        group_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("groups.error.groupNotFound")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM \"MiniPLM\".\"groups\" WHERE id = %s",
            (group_id,),
        )
        if not cur.fetchone():
            return fail("groups.error.groupNotFound")
        cur.execute(
            'UPDATE "MiniPLM"."groups" SET is_disabled = %s WHERE id = %s',
            (data.get("disabled", True), group_id),
        )
        cur.execute(f"{GROUP_BASE} WHERE g.id = %s ORDER BY g.id", (group_id,))
        row = cur.fetchone()
    conn.commit()
    if not row:
        return fail("groups.error.groupNotFound")
    return {"ok": True, "group": group_to_dict(row)}


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
                groups = fetch_groups(cur)
                cur.execute(
                    "SELECT id, login_name, is_disabled FROM \"MiniPLM\".\"users\""
                    " ORDER BY login_name"
                )
                users = [
                    {"id": row[0], "loginName": row[1], "isDisabled": bool(row[2])}
                    for row in cur.fetchall()
                ]
                cur.execute(
                    "SELECT id, name, identifier FROM \"MiniPLM\".\"projects\""
                    " ORDER BY id"
                )
                projects = [
                    {"id": row[0], "name": row[1], "identifier": row[2]}
                    for row in cur.fetchall()
                ]
            return {"ok": True, "groups": groups, "users": users, "projects": projects}

        operation = str(data.get("operation") or "").strip().lower()
        mutating = operation in ("create", "update", "edit", "disable", "enable")
        if mutating and not require_csrf(ctx, args, session):
            return fail("csrf")
        if operation in ("update", "edit"):
            return update_group(conn, data)
        if operation == "create":
            return create_group(conn, data)
        if operation in ("disable", "enable"):
            data["disabled"] = operation == "disable"
            return set_disabled(conn, data)
        return fail("groups.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        message = str(exc)
        if "unique" in message.lower():
            return fail("groups.error.nameTaken")
        return fail("groups.error.request", detail=message)
