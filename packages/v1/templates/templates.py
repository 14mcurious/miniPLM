"""MiniPLM work instance templates.

A template belongs to a project (work area) and defines, as JSON, the
fields a work instance can carry: field name, field type (number, date,
string, attachment, html, xml, custom) and an optional description; for
custom fields the referenced custom type name.

Access: valid Redis session + enabled group attached to the project.
Modes: read (any), create C, update U, delete D.
"""

import json
import re
import time

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]{0,79}$")
FIELD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 _-]{0,63}$")
ALLOWED_TYPES = ("number", "date", "string", "attachment", "html", "xml", "custom")


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


def custom_type_exists(cur, name):
    if not name:
        return False
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."custom_types" WHERE lower(name) = lower(%s)',
        (str(name),),
    )
    return cur.fetchone() is not None


def validate_definition(cur, raw_definition):
    """Normalize and validate the template field definitions."""
    if raw_definition is None:
        raw_definition = []
    if not isinstance(raw_definition, list):
        return None, fail("templates.error.definition")
    definition = []
    seen = set()
    for item in raw_definition:
        if not isinstance(item, dict):
            return None, fail("templates.error.definition")
        field_name = str(item.get("name") or "").strip()
        if not FIELD_NAME_RE.match(field_name):
            return None, fail("templates.error.fieldName")
        key = field_name.lower()
        if key in seen:
            return None, fail("templates.error.fieldDuplicate")
        seen.add(key)
        field_type = str(item.get("type") or "string").strip().lower()
        if field_type not in ALLOWED_TYPES:
            return None, fail("templates.error.fieldType")
        custom_type_name = None
        if field_type == "custom":
            custom_type_name = str(item.get("customType") or "").strip()
            if not custom_type_exists(cur, custom_type_name):
                return None, fail(
                    "templates.error.customTypeNotFound", field=field_name
                )
        description = str(item.get("description") or "").strip()
        if len(description) > 500:
            return None, fail("templates.error.fieldDescription")
        definition.append(
            {
                "name": field_name,
                "type": field_type,
                "description": description,
                "customType": custom_type_name,
            }
        )
    return definition, None


def template_to_dict(row):
    (
        template_id,
        project_id,
        project_name,
        name,
        definition,
        created_at,
        updated_at,
        used_by,
    ) = row
    return {
        "id": template_id,
        "projectId": project_id,
        "projectName": project_name,
        "name": name,
        "definition": definition if isinstance(definition, list) else [],
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
        "usedByCount": int(used_by or 0),
    }


TEMPLATE_SELECT = (
    "SELECT t.id, t.project_id, p.name, t.name, t.definition,"
    " t.created_at, t.updated_at,"
    " (SELECT COUNT(*) FROM \"MiniPLM\".\"work_instances\" wi"
    "  WHERE wi.template_id = t.id) AS used_by"
    ' FROM "MiniPLM"."work_instance_templates" t'
    ' JOIN "MiniPLM"."projects" p ON p.id = t.project_id'
)


def do_list(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if not modes:
            return {"ok": True, "templates": []}
        project_ids = list(modes.keys())
        placeholders = ",".join(["%s"] * len(project_ids))
        sql = f"{TEMPLATE_SELECT} WHERE t.project_id IN ({placeholders})"
        params = list(project_ids)
        if raw_project not in (None, ""):
            try:
                project_id = int(raw_project)
            except (TypeError, ValueError):
                return fail("templates.error.projectNotFound")
            if project_id not in project_ids:
                return fail("forbidden")
            sql += " AND t.project_id = %s"
            params.append(project_id)
        sql += " ORDER BY t.id"
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
    return {"ok": True, "templates": [template_to_dict(r) for r in rows]}


def do_create(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    try:
        project_id = int(raw_project)
    except (TypeError, ValueError):
        return fail("templates.error.projectNotFound")
    name = str(data.get("name") or "").strip()
    if not NAME_RE.match(name):
        return fail("templates.error.nameFormat")

    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "C" not in modes.get(project_id, set()):
            return fail("forbidden")
        definition, error = validate_definition(cur, data.get("definition"))
        if error is not None:
            return error
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."work_instance_templates"'
            " WHERE project_id = %s AND lower(name) = lower(%s)",
            (project_id, name),
        )
        if cur.fetchone():
            return fail("templates.error.nameTaken")
        cur.execute(
            'INSERT INTO "MiniPLM"."work_instance_templates"'
            " (project_id, name, definition) VALUES (%s, %s, %s)",
            (project_id, name, json.dumps(definition)),
        )
        cur.execute(
            'SELECT currval(%s::regclass)',
            ('"MiniPLM".work_instance_templates_id_seq',),
        )
        template_id = cur.fetchone()[0]
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            f"{TEMPLATE_SELECT} WHERE t.id = %s", (template_id,)
        )
        row = cur.fetchone()
    return {"ok": True, "template": template_to_dict(row)}


def do_update(ctx, session, data):
    raw_id = data.get("id")
    try:
        template_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("templates.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT project_id, name FROM "MiniPLM"."work_instance_templates"'
            " WHERE id = %s",
            (template_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("templates.error.notFound")
        project_id, current_name = row
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "U" not in modes.get(project_id, set()):
            return fail("forbidden")

        name = str(data.get("name") or "").strip() or current_name
        if not NAME_RE.match(name):
            return fail("templates.error.nameFormat")
        definition = None
        if "definition" in data:
            definition, error = validate_definition(cur, data["definition"])
            if error is not None:
                return error
        if definition is None:
            cur.execute(
                'SELECT definition FROM "MiniPLM"."work_instance_templates"'
                " WHERE id = %s",
                (template_id,),
            )
            definition = cur.fetchone()[0]
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."work_instance_templates"'
            " WHERE project_id = %s AND lower(name) = lower(%s) AND id <> %s",
            (project_id, name, template_id),
        )
        if cur.fetchone():
            return fail("templates.error.nameTaken")
        cur.execute(
            'UPDATE "MiniPLM"."work_instance_templates"'
            " SET name = %s, definition = %s, updated_at = now()"
            " WHERE id = %s",
            (name, json.dumps(definition), template_id),
        )
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(f"{TEMPLATE_SELECT} WHERE t.id = %s", (template_id,))
        row = cur.fetchone()
    return {"ok": True, "template": template_to_dict(row)}


def do_delete(ctx, session, data):
    raw_id = data.get("id")
    try:
        template_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("templates.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT project_id FROM "MiniPLM"."work_instance_templates"'
            " WHERE id = %s",
            (template_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("templates.error.notFound")
        modes = accessible_project_modes(cur, session.get("userId"))
        if row[0] not in modes or "D" not in modes.get(row[0], set()):
            return fail("forbidden")
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."work_instances"'
            " WHERE template_id = %s LIMIT 1",
            (template_id,),
        )
        if cur.fetchone():
            return fail("templates.error.inUse")
        cur.execute(
            'DELETE FROM "MiniPLM"."work_instance_templates" WHERE id = %s',
            (template_id,),
        )
    ctx.POSTGRESQL.commit()
    return {"ok": True, "deleted": template_id}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Templates not configured"}

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
        if operation in ("list", "list-templates"):
            return do_list(ctx, session, data)
        if operation in ("create", "create-template"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_create(ctx, session, data)
        if operation in ("update", "update-template"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_update(ctx, session, data)
        if operation in ("delete", "delete-template"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_delete(ctx, session, data)
        return fail("templates.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("templates.error.request", detail=str(exc))
