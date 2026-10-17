"""MiniPLM work spaces.

A work space lives inside a project (work area) and can contain zero or
more work spaces (hierarchy) and zero or more work containers.

Access: the caller must have a valid Redis session and an enabled group
attached to the project. Group access modes gate the operations:
read (any mode), create requires ``C``, update ``U``, delete ``D``.
"""

import json
import re
import time

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]{0,79}$")
SYSADMIN_GROUP = "SysAdmin"


def redis_key(ctx, name):
    return f"{getattr(ctx, 'REDIS_PREFIX', '') or ''}{name}"


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
    expected = str(session.get("csrf") or "")
    sent = str(request_headers(args).get("x-csrf-token") or "").strip()
    if not expected or sent != expected:
        return False
    return True


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


def accessible_project_modes(cur, user_id):
    """{project_id: set-of-mode-letters} for the user's enabled groups."""
    cur.execute(
        'SELECT DISTINCT p.id, g.access_mode FROM "MiniPLM"."projects" p'
        ' JOIN "MiniPLM"."group_projects" gp ON gp.project_name = p.name'
        ' JOIN "MiniPLM"."user_groups" ug ON ug.group_id = gp.group_id'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.is_disabled = FALSE",
        (user_id,),
    )
    modes = {}
    for project_id, access_mode in cur.fetchall():
        modes.setdefault(project_id, set()).update(str(access_mode or ""))
    return modes


def project_in_scope(cur, session, project_id):
    """Return (allowed, modes) for the given project."""
    modes = accessible_project_modes(cur, session.get("userId"))
    return project_id in modes, modes.get(project_id, set())


def fetch_workspace(cur, workspace_id):
    cur.execute(
        'SELECT w.id, w.project_id, w.name, w.title, w.parent_id, pw.name'
        ' FROM "MiniPLM"."workspaces" w'
        ' LEFT JOIN "MiniPLM"."workspaces" pw ON pw.id = w.parent_id'
        " WHERE w.id = %s",
        (workspace_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "projectId": row[1],
        "name": row[2],
        "title": row[3],
        "parentId": row[4],
        "parentName": row[5],
        "createdAt": row[6].isoformat() if len(row) > 6 else None,
    }


def do_list(ctx, session, data):
    """List work spaces; optionally scoped to one project."""
    raw_project = data.get("projectId", data.get("project_id"))
    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if not modes:
            return {"ok": True, "workspaces": []}
        project_ids = list(modes.keys())
        placeholders = ",".join(["%s"] * len(project_ids))
        cur.execute(
            'SELECT w.id, w.project_id, w.name, w.title, w.parent_id, pw.name,'
            f" p.name, u.login_name, u.name, u.surname, w.created_at, w.updated_at"
            ' FROM "MiniPLM"."workspaces" w'
            ' LEFT JOIN "MiniPLM"."workspaces" pw ON pw.id = w.parent_id'
            ' JOIN "MiniPLM"."projects" p ON p.id = w.project_id'
            f' LEFT JOIN "MiniPLM"."users" u ON u.id = w.created_by'
            f" WHERE w.project_id IN ({placeholders})"
            " ORDER BY w.project_id, w.id",
            tuple(project_ids),
        )
        rows = cur.fetchall()
    workspaces = []
    for (
        ws_id,
        project_id,
        name,
        title,
        parent_id,
        parent_name,
        project_name,
        login_name,
        first_name,
        surname,
        created_at,
        updated_at,
    ) in rows:
        workspaces.append(
            {
                "id": ws_id,
                "projectId": project_id,
                "projectName": project_name,
                "name": name,
                "title": title,
                "parentId": parent_id,
                "parentName": parent_name,
                "createdBy": (
                    {"loginName": login_name, "name": first_name, "surname": surname}
                    if login_name
                    else None
                ),
                "createdAt": created_at.isoformat() if created_at else None,
                "updatedAt": updated_at.isoformat() if updated_at else None,
            }
        )
    if raw_project not in (None, ""):
        try:
            project_id = int(raw_project)
        except (TypeError, ValueError):
            return fail("workspaces.error.projectNotFound")
        workspaces = [w for w in workspaces if w["projectId"] == project_id]
    return {"ok": True, "workspaces": workspaces}


def do_create(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    try:
        project_id = int(raw_project)
    except (TypeError, ValueError):
        return fail("workspaces.error.projectNotFound")
    name = str(data.get("name") or "").strip()
    if not NAME_RE.match(name):
        return fail("workspaces.error.nameFormat")

    parent_id = None
    raw_parent = data.get("parentId", data.get("parent_id"))
    if raw_parent not in (None, ""):
        try:
            parent_id = int(raw_parent)
        except (TypeError, ValueError):
            return fail("workspaces.error.parentNotFound")

    with ctx.POSTGRESQL.cursor() as cur:
        allowed, modes = project_in_scope(cur, session, project_id)
        if not allowed:
            return fail("forbidden")
        if "C" not in modes:
            return fail("forbidden")
        if parent_id is not None:
            cur.execute(
                'SELECT id FROM "MiniPLM"."workspaces" WHERE id = %s AND project_id = %s',
                (parent_id, project_id),
            )
            if not cur.fetchone():
                return fail("workspaces.error.parentNotFound")
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."workspaces" WHERE project_id = %s AND lower(name) = lower(%s)',
            (project_id, name),
        )
        if cur.fetchone():
            return fail("workspaces.error.nameTaken")
        cur.execute(
            'INSERT INTO "MiniPLM"."workspaces" (project_id, name, title, parent_id, created_by)'
            " VALUES (%s, %s, %s, %s, %s)",
            (
                project_id,
                name,
                str(data.get("title") or "").strip() or None,
                parent_id,
                session.get("userId"),
            ),
        )
        cur.execute('SELECT currval(%s::regclass)', ('"MiniPLM".workspaces_id_seq',))
        ws_id = cur.fetchone()[0]
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        ws = fetch_workspace(cur, ws_id)
    return {"ok": True, "workspace": ws}


def do_update(ctx, session, data):
    raw_id = data.get("id")
    try:
        workspace_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workspaces.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT w.id, w.project_id, w.name, w.title FROM "MiniPLM"."workspaces" w WHERE w.id = %s',
            (workspace_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workspaces.error.notFound")
        _, project_id, current_name, current_title = row
        allowed, modes = project_in_scope(cur, session, project_id)
        if not allowed or "U" not in modes:
            return fail("forbidden")

        name = str(data.get("name") or "").strip() or current_name
        if not NAME_RE.match(name):
            return fail("workspaces.error.nameFormat")
        # An absent/empty title keeps the current value (update is partial).
        title = str(data.get("title") or "").strip() or current_title
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."workspaces"'
            " WHERE project_id = %s AND lower(name) = lower(%s) AND id <> %s",
            (project_id, name, workspace_id),
        )
        if cur.fetchone():
            return fail("workspaces.error.nameTaken")
        cur.execute(
            'UPDATE "MiniPLM"."workspaces" SET name = %s, title = %s, updated_at = now()'
            " WHERE id = %s",
            (name, title, workspace_id),
        )
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        ws = fetch_workspace(cur, workspace_id)
    return {"ok": True, "workspace": ws}


def do_delete(ctx, session, data):
    raw_id = data.get("id")
    try:
        workspace_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workspaces.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT project_id FROM "MiniPLM"."workspaces" WHERE id = %s',
            (workspace_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workspaces.error.notFound")
        allowed, modes = project_in_scope(cur, session, row[0])
        if not allowed or "D" not in modes:
            return fail("forbidden")
        # Cascade: child work spaces, work containers and their instances.
        cur.execute('DELETE FROM "MiniPLM"."workspaces" WHERE id = %s', (workspace_id,))
    ctx.POSTGRESQL.commit()
    return {"ok": True, "deleted": workspace_id}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Work spaces not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    try:
        session, error = require_session(ctx, args)
        if error is not None:
            return error

        if method == "GET":
            return do_list(ctx, session, data)

        operation = str(data.get("operation") or "").strip().lower()
        if operation in ("list", "list-workspaces"):
            return do_list(ctx, session, data)
        if operation in ("create",):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_create(ctx, session, data)
        if operation in ("update", "update-workspace"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_update(ctx, session, data)
        if operation in ("delete", "delete-workspace"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_delete(ctx, session, data)
        return fail("workspaces.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("workspaces.error.request", detail=str(exc))
