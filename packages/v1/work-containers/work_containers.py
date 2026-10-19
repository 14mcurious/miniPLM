"""MiniPLM work containers.

A work container is an entity with a unique identifier (WC-000001 style),
name, title, author, progress (validated against the workflow progress
custom type configured in the Configuration page when one is designated),
description, created/updated timestamps and a full history of the users who
created or modified it (with dates and changed fields). Zero or more work
instances can be linked to a work container.

Access: valid Redis session + an enabled group attached to the project.
Group access modes gate the operations: read (any mode), create ``C``,
update ``U``, delete ``D``.
"""

import json
import re
import time

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]{0,79}$")


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


def progress_workflow(cur):
    """Full descriptor of the designated workflow progress type.

    Returns {options, transitions, initialState} when a workflow progress
    type is designated, or None (progress is free text).
    """
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        ("workflow_progress_type",),
    )
    row = cur.fetchone()
    type_name = (row[0] if row else "").strip()
    if not type_name:
        return None
    cur.execute(
        'SELECT options, initial_state, transitions FROM "MiniPLM"."custom_types"'
        " WHERE lower(name) = lower(%s) AND is_disabled = FALSE",
        (type_name,),
    )
    row = cur.fetchone()
    if not row:
        return None
    options = []
    raw_options = row[0]
    if isinstance(raw_options, list):
        for item in raw_options:
            if not isinstance(item, dict):
                continue
            value = str(item.get("value") or "").strip()
            if not value:
                continue
            options.append(
                {
                    "label": str(item.get("label") or value).strip(),
                    "value": value,
                    "description": str(item.get("description") or "").strip(),
                }
            )
    transitions = []
    if isinstance(row[2], list):
        for item in row[2]:
            if not isinstance(item, dict):
                continue
            src = str(item.get("from") or "").strip()
            dst = str(item.get("to") or "").strip()
            if not src or not dst:
                continue
            role = item.get("role")
            role = str(role).strip() if role not in (None, "") else None
            transitions.append({"from": src, "to": dst, "role": role})
    initial_state = str(row[1]).strip() if row[1] else None
    if not options:
        return None
    return {
        "options": options,
        "transitions": transitions,
        "initialState": initial_state,
    }


def progress_options(cur):
    """Options of the designated workflow progress type, or None (free text)."""
    workflow = progress_workflow(cur)
    if workflow is None:
        return None
    return [{"label": o["label"], "value": o["value"]} for o in workflow["options"]]


def validate_progress(progress_value, options):
    """Progress must be one of the designated type's option values."""
    if progress_value in (None, ""):
        return None
    if options is None:
        return None  # free text
    for option in options:
        if option["value"] == str(progress_value):
            return None
    return "workContainers.error.progressInvalid"


def user_role_names(cur, user_id):
    """Workflow role names assigned to the user."""
    cur.execute(
        'SELECT r.name FROM "MiniPLM"."roles" r'
        ' JOIN "MiniPLM"."user_roles" ur ON ur.role_id = r.id'
        " WHERE ur.user_id = %s",
        (user_id,),
    )
    return [str(row[0]) for row in cur.fetchall()]


def validate_progress_change(cur, session, current_progress, new_value, on_create=False):
    """Apply the workflow transition rules to a progress value.

    On create: when the workflow defines transitions, a new object must
    start from its initial state (or leave the progress empty). On
    update: the new state must be reachable from the current state by a
    transition, and the user must hold the role the transition requires
    (a null role means any user).
    """
    value = str(new_value or "").strip()
    if not value:
        return None
    workflow = progress_workflow(cur)
    if workflow is None:
        return None
    transitions = workflow["transitions"]
    if on_create:
        if not transitions:
            return None
        initial = workflow.get("initialState")
        if initial and value != initial:
            return fail(
                "workContainers.error.progressTransition",
                **{"from": initial, "to": value},
            )
        return None
    current = str(current_progress or "").strip()
    if current == value:
        return None
    if not transitions:
        return None
    option_values = {o["value"] for o in workflow["options"]}
    if current in option_values:
        roles = set(user_role_names(cur, session.get("userId")))
        for transition in transitions:
            if transition["from"] != current or transition["to"] != value:
                continue
            role = transition.get("role")
            if role in (None, "") or role in roles:
                return None
        return fail(
            "workContainers.error.progressTransition",
            **{"from": current, "to": value},
        )
    # Current value is empty or legacy (not a workflow option): the first
    # assignment must target the initial state when one is defined.
    initial = workflow.get("initialState")
    if initial:
        if value == initial:
            return None
        return fail(
            "workContainers.error.progressTransition",
            **{"from": initial, "to": value},
        )
    return None


def container_row_to_dict(row):
    (
        container_id,
        identifier,
        project_id,
        project_name,
        workspace_id,
        workspace_name,
        name,
        title,
        description,
        progress,
        author_login,
        author_name,
        author_surname,
        created_at,
        updated_at,
        instance_count,
    ) = row
    return {
        "id": container_id,
        "identifier": identifier,
        "projectId": project_id,
        "projectName": project_name,
        "workspaceId": workspace_id,
        "workspaceName": workspace_name,
        "name": name,
        "title": title,
        "description": description,
        "progress": progress,
        "author": (
            {
                "loginName": author_login,
                "name": author_name,
                "surname": author_surname,
            }
            if author_login
            else None
        ),
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
        "instanceCount": int(instance_count or 0),
    }


CONTAINER_SELECT = (
    "SELECT c.id, c.identifier, c.project_id, p.name, c.workspace_id, ws.name,"
    " c.name, c.title, c.description, c.progress,"
    " u.login_name, u.name, u.surname, c.created_at, c.updated_at,"
    " (SELECT COUNT(*) FROM \"MiniPLM\".\"work_instances\" wi"
    "  WHERE wi.work_container_id = c.id) AS instance_count"
    ' FROM "MiniPLM"."work_containers" c'
    ' JOIN "MiniPLM"."projects" p ON p.id = c.project_id'
    ' LEFT JOIN "MiniPLM"."workspaces" ws ON ws.id = c.workspace_id'
    ' LEFT JOIN "MiniPLM"."users" u ON u.id = c.author_id'
)


def do_list(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    raw_workspace = data.get("workspaceId", data.get("workspace_id"))
    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if not modes:
            return {
                "ok": True,
                "workContainers": [],
                "progressOptions": None,
                "progressWorkflow": None,
                "userRoles": [],
            }
        project_ids = list(modes.keys())
        placeholders = ",".join(["%s"] * len(project_ids))
        sql = (
            f"{CONTAINER_SELECT} WHERE c.project_id IN ({placeholders})"
        )
        params = list(project_ids)
        if raw_workspace not in (None, ""):
            try:
                workspace_id = int(raw_workspace)
            except (TypeError, ValueError):
                return fail("workContainers.error.workspaceNotFound")
            sql += " AND c.workspace_id = %s"
            params.append(workspace_id)
        elif raw_project not in (None, ""):
            try:
                project_id = int(raw_project)
            except (TypeError, ValueError):
                return fail("workContainers.error.projectNotFound")
            if project_id not in project_ids:
                return fail("forbidden")
            sql += " AND c.project_id = %s"
            params.append(project_id)
        sql += " ORDER BY c.id"
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        workflow = progress_workflow(cur)
        user_roles = user_role_names(cur, session.get("userId"))
    options = (
        [{"label": o["label"], "value": o["value"]} for o in workflow["options"]]
        if workflow is not None
        else None
    )
    return {
        "ok": True,
        "workContainers": [container_row_to_dict(r) for r in rows],
        "progressOptions": options,
        "progressWorkflow": workflow,
        "userRoles": user_roles,
    }


def do_create(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    try:
        project_id = int(raw_project)
    except (TypeError, ValueError):
        return fail("workContainers.error.projectNotFound")
    name = str(data.get("name") or "").strip()
    if not NAME_RE.match(name):
        return fail("workContainers.error.nameFormat")

    workspace_id = None
    raw_workspace = data.get("workspaceId", data.get("workspace_id"))
    if raw_workspace in (None, ""):
        # Work containers always live inside a work space.
        return fail("workContainers.error.workspaceRequired")
    try:
        workspace_id = int(raw_workspace)
    except (TypeError, ValueError):
        return fail("workContainers.error.workspaceNotFound")

    progress_value = str(data.get("progress") or "").strip() or None

    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "C" not in modes.get(project_id, set()):
            return fail("forbidden")
        if workspace_id is not None:
            cur.execute(
                'SELECT id FROM "MiniPLM"."workspaces" WHERE id = %s AND project_id = %s',
                (workspace_id, project_id),
            )
            if not cur.fetchone():
                return fail("workContainers.error.workspaceNotFound")
        options = progress_options(cur)
        error = validate_progress(progress_value, options)
        if error:
            return fail(error)
        error = validate_progress_change(
            cur, session, None, progress_value, on_create=True
        )
        if error:
            return fail(error)
        cur.execute(
            'INSERT INTO "MiniPLM"."work_containers"'
            " (identifier, project_id, workspace_id, name, title, description,"
            "  progress, author_id)"
            " VALUES ('WC-PENDING', %s, %s, %s, %s, %s, %s, %s)",
            (
                project_id,
                workspace_id,
                name,
                str(data.get("title") or "").strip() or None,
                str(data.get("description") or "").strip() or None,
                progress_value,
                session.get("userId"),
            ),
        )
        cur.execute(
            'SELECT currval(%s::regclass)',
            ('"MiniPLM".work_containers_id_seq',),
        )
        container_id = cur.fetchone()[0]
        identifier = f"WC-{container_id:06d}"
        cur.execute(
            'UPDATE "MiniPLM"."work_containers" SET identifier = %s WHERE id = %s',
            (identifier, container_id),
        )
        cur.execute(
            'INSERT INTO "MiniPLM"."work_container_history"'
            " (work_container_id, user_id, action, changed_fields)"
            " VALUES (%s, %s, 'created', %s)",
            (
                container_id,
                session.get("userId"),
                json.dumps(["name", "title", "description", "progress"]),
            ),
        )
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(f"{CONTAINER_SELECT} WHERE c.id = %s", (container_id,))
        row = cur.fetchone()
    return {"ok": True, "workContainer": container_row_to_dict(row)}


def do_update(ctx, session, data):
    raw_id = data.get("id", data.get("workContainerId", data.get("work_container_id")))
    try:
        container_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workContainers.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT c.project_id, c.name, c.title, c.description, c.progress'
            ' FROM "MiniPLM"."work_containers" c WHERE c.id = %s',
            (container_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workContainers.error.notFound")
        project_id, current_name, current_title, current_description, current_progress = row
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "U" not in modes.get(project_id, set()):
            return fail("forbidden")

        changed = []
        name = str(data.get("name") or "").strip() or current_name
        if name != current_name:
            if not NAME_RE.match(name):
                return fail("workContainers.error.nameFormat")
            changed.append("name")
        # An absent/empty title keeps the current value (update is partial).
        title = str(data.get("title") or "").strip() or current_title
        if title != current_title:
            changed.append("title")
        # An absent/empty description keeps the current value (partial update).
        description = str(data.get("description") or "").strip() or current_description
        if description != current_description:
            changed.append("description")
        progress_value = (
            str(data.get("progress") or "").strip() or None
            if "progress" in data
            else current_progress
        )
        if progress_value != current_progress:
            options = progress_options(cur)
            error = validate_progress(progress_value, options)
            if error:
                return fail(error)
            error = validate_progress_change(
                cur, session, current_progress, progress_value
            )
            if error:
                return fail(error)
            changed.append("progress")
        if not changed:
            return fail("workContainers.error.noChange")

        cur.execute(
            'UPDATE "MiniPLM"."work_containers"'
            " SET name = %s, title = %s, description = %s, progress = %s,"
            "     updated_at = now()"
            " WHERE id = %s",
            (name, title, description, progress_value, container_id),
        )
        cur.execute(
            'INSERT INTO "MiniPLM"."work_container_history"'
            " (work_container_id, user_id, action, changed_fields)"
            " VALUES (%s, %s, 'updated', %s)",
            (container_id, session.get("userId"), json.dumps(changed)),
        )
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(f"{CONTAINER_SELECT} WHERE c.id = %s", (container_id,))
        row = cur.fetchone()
    return {"ok": True, "workContainer": container_row_to_dict(row)}


def do_delete(ctx, session, data):
    raw_id = data.get("id", data.get("workContainerId", data.get("work_container_id")))
    try:
        container_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workContainers.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT project_id FROM "MiniPLM"."work_containers" WHERE id = %s',
            (container_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workContainers.error.notFound")
        modes = accessible_project_modes(cur, session.get("userId"))
        if row[0] not in modes or "D" not in modes.get(row[0], set()):
            return fail("forbidden")
        # Cascade: the linked work instances and the history rows.
        cur.execute(
            'DELETE FROM "MiniPLM"."work_containers" WHERE id = %s',
            (container_id,),
        )
    ctx.POSTGRESQL.commit()
    return {"ok": True, "deleted": container_id}


def do_history(ctx, session, data):
    raw_id = data.get("id", data.get("workContainerId", data.get("work_container_id")))
    try:
        container_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workContainers.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT project_id FROM "MiniPLM"."work_containers" WHERE id = %s',
            (container_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workContainers.error.notFound")
        modes = accessible_project_modes(cur, session.get("userId"))
        if row[0] not in modes:
            return fail("forbidden")
        cur.execute(
            'SELECT h.action, h.changed_fields, h.created_at,'
            " u.login_name, u.name, u.surname"
            ' FROM "MiniPLM"."work_container_history" h'
            ' LEFT JOIN "MiniPLM"."users" u ON u.id = h.user_id'
            " WHERE h.work_container_id = %s"
            " ORDER BY h.id",
            (container_id,),
        )
        rows = cur.fetchall()
    entries = []
    for action, changed_fields, at, login_name, first_name, surname in rows:
        try:
            fields = json.loads(changed_fields) if changed_fields else []
        except Exception:
            fields = []
        entries.append(
            {
                "action": action,
                "changedFields": fields,
                "at": at.isoformat() if at else None,
                "user": (
                    {
                        "loginName": login_name,
                        "name": first_name,
                        "surname": surname,
                    }
                    if login_name
                    else None
                ),
            }
        )
    return {"ok": True, "history": entries}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Work containers not configured"}

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
        if operation in ("list", "list-work-containers"):
            return do_list(ctx, session, data)
        if operation in ("create", "create-work-container"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_create(ctx, session, data)
        if operation in ("update", "update-work-container"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_update(ctx, session, data)
        if operation in ("delete", "delete-work-container"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_delete(ctx, session, data)
        if operation in ("history", "history-work-container"):
            return do_history(ctx, session, data)
        return fail("workContainers.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("workContainers.error.request", detail=str(exc))
