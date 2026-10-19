import json
import re
import time

DEFAULT_MAX_SUBPROJECT_LEVELS = 10
MAX_ALLOWED_SUBPROJECT_LEVELS = 1000
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]*$")
# S3 keys of work instance attachments (see v1/attachments):
# "work-instances/<uuid>/<file name>".
S3_KEY_RE = re.compile(r"^work-instances/[A-Za-z0-9._/-]+$")

PROJECT_COLUMNS = (
    "p.id, p.name, p.identifier, p.parent_id, p.level, "
    "pp.name AS parent_name"
)

PROJECT_SELECT = (
    f"SELECT {PROJECT_COLUMNS}"
    ' FROM "MiniPLM"."projects" p'
    ' LEFT JOIN "MiniPLM"."projects" pp ON pp.id = p.parent_id'
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


def get_setting(cur, key, default):
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        (key,),
    )
    row = cur.fetchone()
    if row:
        try:
            return max(1, int(row[0]))
        except (TypeError, ValueError):
            pass
    return default


def get_max_subproject_levels(cur):
    return get_setting(cur, "max_subproject_levels", DEFAULT_MAX_SUBPROJECT_LEVELS)


def derive_identifier(name):
    """System identifier: the name without any space characters."""
    return re.sub(r"\s+", "", name)


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


def fetch_projects(cur):
    cur.execute(f"{PROJECT_SELECT} ORDER BY p.id")
    return [project_to_dict(row) for row in cur.fetchall()]


def create_project(conn, data):
    name = str(data.get("name") or "").strip()
    if not name:
        return fail("projects.error.nameRequired")
    if not NAME_RE.match(name):
        return fail("projects.error.nameFormat")

    # Parent: optional. If given it must be an existing project.
    raw_parent = data.get("parentId", data.get("parent_id"))
    parent_id = None
    if raw_parent not in (None, ""):
        try:
            parent_id = int(raw_parent)
        except (TypeError, ValueError):
            return fail("projects.error.parentNotFound")

    with conn.cursor() as cur:
        max_levels = get_max_subproject_levels(cur)

        if parent_id is not None:
            cur.execute(
                'SELECT id, level FROM "MiniPLM"."projects" WHERE id = %s',
                (parent_id,),
            )
            row = cur.fetchone()
            if not row:
                return fail("projects.error.parentNotFound")
            parent_level = int(row[1])
            # Roots sit at level 0; the new child is one level deeper.
            # The depth limit bounds the number of sub-project levels.
            if parent_level + 1 > max_levels:
                return fail("projects.error.levelLimit", max=max_levels)

        identifier = derive_identifier(name)
        # Uniqueness of the identifier (name without spaces) is system-wide,
        # case-insensitive.
        cur.execute(
            "SELECT 1 FROM \"MiniPLM\".\"projects\" WHERE lower(identifier) = lower(%s)",
            (identifier,),
        )
        if cur.fetchone():
            return fail("projects.error.nameTaken")

        level = 0 if parent_id is None else int(row[1]) + 1
        cur.execute(
            'INSERT INTO "MiniPLM"."projects" (name, identifier, parent_id, level)'
            " VALUES (%s, %s, %s, %s)",
            (name, identifier, parent_id, level),
        )
        project_id = cur.lastrowid if hasattr(cur, "lastrowid") else None
        if project_id is None:
            cur.execute(
                "SELECT id FROM \"MiniPLM\".\"projects\" WHERE lower(identifier) = lower(%s)",
                (identifier,),
            )
            found = cur.fetchone()
            project_id = found[0] if found else None

    conn.commit()

    with conn.cursor() as cur:
        cur.execute(
            f"{PROJECT_SELECT} WHERE p.id = %s",
            (project_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("projects.error.projectNotFound")
    return {"ok": True, "project": project_to_dict(row)}


def parse_project_ids(data):
    """Normalize the requested project ids (list, comma string or int)."""
    raw = data.get("ids", data.get("id"))
    if raw is None:
        return None, fail("projects.error.idsRequired")
    if isinstance(raw, bool):
        return None, fail("projects.error.idsRequired")
    if isinstance(raw, int):
        raw = [raw]
    elif isinstance(raw, str):
        raw = [part for part in raw.split(",") if part.strip()]
    if not isinstance(raw, list) or not raw:
        return None, fail("projects.error.idsRequired")
    ids = []
    for value in raw:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            return None, fail("projects.error.idsRequired")
    return sorted(set(ids)), None


def project_closure(cur, ids):
    """Map {id: name} of the selected projects and all their descendants."""
    cur.execute(
        'WITH RECURSIVE closure AS ('
        '  SELECT id, name FROM "MiniPLM"."projects" WHERE id = ANY(%s)'
        '  UNION ALL'
        '  SELECT p.id, p.name FROM "MiniPLM"."projects" p'
        '  JOIN closure c ON p.parent_id = c.id'
        ') SELECT id, name FROM closure',
        (ids,),
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def collect_attachment_keys(cur, project_ids):
    """S3 keys referenced by the work instances of the given projects."""
    keys = set()
    cur.execute(
        'SELECT fields FROM "MiniPLM"."work_instances"'
        " WHERE project_id = ANY(%s)",
        (project_ids,),
    )
    for (fields,) in cur.fetchall():
        if isinstance(fields, str):
            try:
                fields = json.loads(fields)
            except Exception:
                continue
        if not isinstance(fields, list):
            continue
        for field in fields:
            if not isinstance(field, dict):
                continue
            if str(field.get("type") or "").lower() != "attachment":
                continue
            value = field.get("value")
            key = None
            if isinstance(value, dict):
                key = value.get("s3Key") or value.get("s3_key")
            elif isinstance(value, str):
                key = value
            key = str(key or "").strip()
            if S3_KEY_RE.match(key):
                keys.add(key)
    return sorted(keys)


def delete_projects(conn, ctx, data):
    """Delete the selected projects with their full work area data.

    Cascades (ON DELETE CASCADE) to the sub-projects, work spaces, work
    containers, work instances, instance templates and container history.
    Groups that were associated with the deleted projects are removed as
    well (their user memberships cascade; the users themselves stay). A
    group keeps its life if it is still linked to a project that survives
    the deletion.
    """
    ids, error = parse_project_ids(data)
    if error is not None:
        return error
    with conn.cursor() as cur:
        closure = project_closure(cur, ids)
    if not closure:
        return fail("projects.error.projectNotFound")
    project_ids = sorted(closure)
    project_names = sorted(set(closure.values()))
    with conn.cursor() as cur:
        attachment_keys = collect_attachment_keys(cur, project_ids)
        # Groups that reference at least one deleted project (before the
        # links are removed): only these may be dropped.
        cur.execute(
            'SELECT DISTINCT group_id FROM "MiniPLM"."group_projects"'
            " WHERE project_name = ANY(%s)",
            (project_names,),
        )
        affected_group_ids = sorted(row[0] for row in cur.fetchall())
        # Unlink the groups that reference the deleted projects.
        cur.execute(
            'DELETE FROM "MiniPLM"."group_projects"'
            " WHERE project_name = ANY(%s)",
            (project_names,),
        )
        # Deleting the projects cascades to the whole work area.
        cur.execute(
            'DELETE FROM "MiniPLM"."projects" WHERE id = ANY(%s)',
            (project_ids,),
        )
        # Drop the groups that lost their last project link (membership in
        # user_groups cascades; the users themselves are never touched).
        deleted_group_names = []
        if affected_group_ids:
            cur.execute(
                'SELECT id, name FROM "MiniPLM"."groups" WHERE id = ANY(%s)',
                (affected_group_ids,),
            )
            affected = {row[0]: row[1] for row in cur.fetchall()}
            cur.execute(
                'DELETE FROM "MiniPLM"."groups" g'
                " WHERE g.id = ANY(%s)"
                ' AND NOT EXISTS ('
                '  SELECT 1 FROM "MiniPLM"."group_projects" gp'
                '  WHERE gp.group_id = g.id'
                ')',
                (affected_group_ids,),
            )
            cur.execute(
                'SELECT id FROM "MiniPLM"."groups" WHERE id = ANY(%s)',
                (affected_group_ids,),
            )
            kept_ids = {row[0] for row in cur.fetchall()}
            deleted_group_names = sorted(
                name for group_id, name in affected.items()
                if group_id not in kept_ids
            )
    conn.commit()
    # Best-effort removal of the S3 objects referenced by the deleted work
    # instances (orphaned after the DB commit); the database is the source
    # of truth, so S3 failures do not fail the deletion.
    s3_client = getattr(ctx, "S3_CLIENT", None)
    s3_bucket = getattr(ctx, "S3_DATA", None)
    attachments_deleted = 0
    attachments_failed = 0
    if s3_client is not None and s3_bucket is not None:
        for key in attachment_keys:
            try:
                s3_client.delete_object(Bucket=s3_bucket, Key=key)
                attachments_deleted += 1
            except Exception:
                attachments_failed += 1
    return {
        "ok": True,
        "deletedProjects": len(project_ids),
        "deletedNames": project_names,
        "deletedGroups": len(deleted_group_names),
        "deletedGroupNames": deleted_group_names,
        "attachmentsDeleted": attachments_deleted,
        "attachmentsFailed": attachments_failed,
    }


def fetch_subtree(cur, project_id):
    """Map of {id: level} for the project and all its descendants."""
    cur.execute(
        'WITH RECURSIVE subtree AS ('
        '  SELECT id, level FROM "MiniPLM"."projects" WHERE id = %s'
        '  UNION ALL'
        '  SELECT p.id, p.level FROM "MiniPLM"."projects" p'
        '  JOIN subtree s ON p.parent_id = s.id'
        ') SELECT id, level FROM subtree',
        (project_id,),
    )
    return {row[0]: int(row[1]) for row in cur.fetchall()}


def update_parent(conn, data):
    """Change the parent project (the only editable field after creation)."""
    raw_id = data.get("id")
    try:
        project_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("projects.error.projectNotFound")

    raw_parent = data.get("parentId", data.get("parent_id"))
    parent_id = None
    if raw_parent not in (None, ""):
        try:
            parent_id = int(raw_parent)
        except (TypeError, ValueError):
            return fail("projects.error.parentNotFound")

    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, level FROM "MiniPLM"."projects" WHERE id = %s',
            (project_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("projects.error.projectNotFound")
        current_level = int(row[1])

        new_level = 0
        if parent_id is not None:
            cur.execute(
                'SELECT id, level FROM "MiniPLM"."projects" WHERE id = %s',
                (parent_id,),
            )
            parent_row = cur.fetchone()
            if not parent_row:
                return fail("projects.error.parentNotFound")
            new_level = int(parent_row[1]) + 1

            subtree = fetch_subtree(cur, project_id)
            # Cycle guard: the new parent cannot be the project itself or
            # one of its own descendants.
            if parent_id in subtree:
                return fail("projects.error.cyclicParent")

            # The whole subtree moves with the project, so the depth limit
            # must hold for the deepest descendant after the move.
            max_levels = get_max_subproject_levels(cur)
            max_offset = max(level - current_level for level in subtree.values())
            if new_level + max_offset > max_levels:
                return fail("projects.error.levelLimit", max=max_levels)

        delta = new_level - current_level
        cur.execute(
            'UPDATE "MiniPLM"."projects" SET parent_id = %s, updated_at = now()'
            " WHERE id = %s",
            (parent_id, project_id),
        )
        if delta != 0:
            cur.execute(
                'WITH RECURSIVE subtree AS ('
                '  SELECT id FROM "MiniPLM"."projects" WHERE id = %s'
                '  UNION ALL'
                '  SELECT p.id FROM "MiniPLM"."projects" p'
                '  JOIN subtree s ON p.parent_id = s.id'
                ') UPDATE "MiniPLM"."projects" p'
                " SET level = p.level + %s, updated_at = now()"
                " FROM subtree s"
                " WHERE p.id = s.id",
                (project_id, delta),
            )

    conn.commit()

    with conn.cursor() as cur:
        cur.execute(
            f"{PROJECT_SELECT} WHERE p.id = %s",
            (project_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("projects.error.projectNotFound")
    return {"ok": True, "project": project_to_dict(row)}


def update_settings(conn, data):
    raw = data.get("maxSubprojectLevels", data.get("max_subproject_levels"))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return fail("projects.error.invalidLevelLimit")
    if value < 1 or value > MAX_ALLOWED_SUBPROJECT_LEVELS:
        return fail("projects.error.invalidLevelLimit", max=MAX_ALLOWED_SUBPROJECT_LEVELS)

    with conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
            " ON CONFLICT (key) DO UPDATE SET value = %s",
            ("max_subproject_levels", str(value), str(value)),
        )
    conn.commit()
    return {"ok": True, "maxSubprojectLevels": value}


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
                max_levels = get_max_subproject_levels(cur)
                projects = fetch_projects(cur)
            return {
                "ok": True,
                "maxSubprojectLevels": max_levels,
                "projects": projects,
            }

        operation = str(data.get("operation") or "").strip().lower()
        mutating = operation in (
            "create",
            "update-parent",
            "updateparent",
            "set-parent",
            "update-settings",
            "updatesettings",
            "set-max-levels",
            "delete",
            "delete-selected",
        )
        if mutating and not require_csrf(ctx, args, session):
            return fail("csrf")
        if operation == "create":
            return create_project(conn, data)
        if operation in ("delete", "delete-selected"):
            return delete_projects(conn, ctx, data)
        if operation in ("update-parent", "updateparent", "set-parent"):
            return update_parent(conn, data)
        if operation in ("update-settings", "updatesettings", "set-max-levels"):
            return update_settings(conn, data)
        return fail("projects.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        message = str(exc)
        if "unique" in message.lower():
            return fail("projects.error.nameTaken")
        return fail("projects.error.request", detail=message)
