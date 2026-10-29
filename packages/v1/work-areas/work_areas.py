"""MiniPLM work areas.

A work area is associated 1-to-1 with a project; the work area of default
name carries the project's own name. A user can see and enter only the work
areas of the projects attached to the (enabled) groups the user belongs to.
The SysAdmin group has no project attachment, so by default it grants no
work area access.

Every call requires a valid Redis session; access is re-checked live
against the database on each request.
"""

import json
import time

PROJECT_SELECT = (
    "SELECT p.id, p.name, p.identifier, p.parent_id, p.level,"
    " pp.name AS parent_name"
    ' FROM "MiniPLM"."projects" p'
    ' LEFT JOIN "MiniPLM"."projects" pp ON pp.id = p.parent_id'
    " WHERE p.id = %s"
)

# --- Session guard (Redis-backed opaque sessions) --------------------------
#
# Every Redis key is built from the generated ctx.REDIS_PREFIX plus an
# app-local suffix, as required by the Nuvolaris Redis ACL.


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


def accessible_projects(cur, user_id):
    """Projects reachable through the user's enabled groups (deduplicated),
    with the fields needed to render the project tree (parent and level).
    """
    cur.execute(
        'SELECT DISTINCT p.id, p.name, p.identifier, p.parent_id, p.level,'
        ' pp.name AS parent_name'
        ' FROM "MiniPLM"."projects" p'
        ' JOIN "MiniPLM"."group_projects" gp ON gp.project_name = p.name'
        ' JOIN "MiniPLM"."user_groups" ug ON ug.group_id = gp.group_id'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        ' LEFT JOIN "MiniPLM"."projects" pp ON pp.id = p.parent_id'
        " WHERE ug.user_id = %s AND g.is_disabled = FALSE"
        " ORDER BY p.name",
        (user_id,),
    )
    return [
        {
            "id": row[0],
            "name": row[1],
            "identifier": row[2],
            "parentId": row[3],
            "level": int(row[4]),
            "parentName": row[5],
            "isRoot": row[3] is None,
        }
        for row in cur.fetchall()
    ]


# --- Work area operations ---------------------------------------------------


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


def project_to_dict(row):
    (project_id, name, identifier, parent_id, level, parent_name) = row
    return {
        "id": project_id,
        "name": name,
        "identifier": identifier,
        "parentId": parent_id,
        "parentName": parent_name,
        "level": int(level),
        "isRoot": parent_id is None,
    }


def do_list(ctx, session):
    with ctx.POSTGRESQL.cursor() as cur:
        work_areas = accessible_projects(cur, session.get("userId"))
    return {"ok": True, "workAreas": work_areas}


def do_get(ctx, session, data):
    raw_id = data.get("projectId", data.get("project_id", data.get("id")))
    try:
        project_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workAreas.error.projectNotFound")

    with ctx.POSTGRESQL.cursor() as cur:
        allowed = {
            area["id"] for area in accessible_projects(cur, session.get("userId"))
        }
        if project_id not in allowed:
            return fail("workAreas.error.forbidden")
        cur.execute(PROJECT_SELECT, (project_id,))
        row = cur.fetchone()
        if not row:
            return fail("workAreas.error.projectNotFound")
    project = project_to_dict(row)
    # A work area carries the name of its project (1-to-1 association).
    return {
        "ok": True,
        "project": project,
        "workArea": {"name": project["name"], "projectId": project["id"]},
    }


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Work areas not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    try:
        session, error = require_session(ctx, args)
        if error is not None:
            return error

        if method == "GET":
            return do_list(ctx, session)

        operation = str(data.get("operation") or "").strip().lower()
        if operation in ("list", "list-work-areas", "work-areas"):
            return do_list(ctx, session)
        if operation in ("get", "get-work-area", "enter"):
            return do_get(ctx, session, data)
        return fail("workAreas.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("workAreas.error.request", detail=str(exc))
