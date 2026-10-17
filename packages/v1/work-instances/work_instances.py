"""MiniPLM work instances.

A work instance is a document, file or information entity linked to a work
container. Its data shape can be defined by a JSON template (per project):
the template lists the allowed fields (name, type, optional description,
and the referenced custom type for custom-type fields).

Instance fields support these types:
  number, date, string, attachment (S3 object reference), html, xml,
  custom (value(s) of a configured custom type).

Progress is validated against the designated workflow progress custom type
(see the work-containers module) when one is configured.

Access: valid Redis session + enabled group attached to the project.
Modes: read (any), create C, update U, delete D.
"""

import json
import re
import time
import xml.etree.ElementTree as ElementTree

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]{0,79}$")
FIELD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 _-]{0,63}$")
ALLOWED_TYPES = ("number", "date", "string", "attachment", "html", "xml", "custom")
DATE_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$"
)


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


def progress_options(cur):
    """Options of the designated workflow progress type, or None (free text)."""
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        ("workflow_progress_type",),
    )
    row = cur.fetchone()
    type_name = (row[0] if row else "").strip()
    if not type_name:
        return None
    cur.execute(
        'SELECT options FROM "MiniPLM"."custom_types"'
        " WHERE lower(name) = lower(%s) AND is_disabled = FALSE",
        (type_name,),
    )
    row = cur.fetchone()
    if not row:
        return None
    raw_options = row[0]
    if not isinstance(raw_options, list):
        return None
    options = []
    for item in raw_options:
        if not isinstance(item, dict):
            continue
        value = str(item.get("value") or "").strip()
        if not value:
            continue
        options.append(
            {"label": str(item.get("label") or value).strip(), "value": value}
        )
    return options or None


def validate_progress(progress_value, options):
    if progress_value in (None, ""):
        return None
    if options is None:
        return None
    for option in options:
        if option["value"] == str(progress_value):
            return None
    return "workInstances.error.progressInvalid"


def fetch_custom_type(cur, name):
    if not name:
        return None
    cur.execute(
        'SELECT name, value_type, multi_select, options, is_disabled'
        ' FROM "MiniPLM"."custom_types" WHERE lower(name) = lower(%s)',
        (str(name),),
    )
    row = cur.fetchone()
    if not row:
        return None
    options = row[3] if isinstance(row[3], list) else []
    return {
        "name": row[0],
        "valueType": row[1],
        "multiSelect": bool(row[2]),
        "options": options,
        "isDisabled": bool(row[4]),
    }


def option_values(custom_type):
    values = []
    for item in custom_type.get("options", []):
        if not isinstance(item, dict):
            continue
        value = str(item.get("value") or "").strip()
        if value:
            values.append(value)
    return values


def validate_field_value(field_type, value, custom_type):
    """Validate one field value; return None or an error key."""
    if value is None:
        return None
    if field_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return "workInstances.error.fieldType"
        return None
    if field_type == "date":
        if not isinstance(value, str) or not DATE_RE.match(value.strip()):
            return "workInstances.error.fieldType"
        return None
    if field_type in ("string", "html"):
        if not isinstance(value, str):
            return "workInstances.error.fieldType"
        return None
    if field_type == "xml":
        if not isinstance(value, str) or not value.strip():
            return "workInstances.error.fieldType"
        try:
            ElementTree.fromstring(value)
        except ElementTree.ParseError:
            return "workInstances.error.xmlInvalid"
        return None
    if field_type == "attachment":
        if not isinstance(value, dict):
            return "workInstances.error.fieldType"
        if not str(value.get("s3Key") or "").strip() or not str(
            value.get("fileName") or ""
        ).strip():
            return "workInstances.error.attachment"
        return None
    if field_type == "custom":
        if custom_type is None or custom_type.get("isDisabled"):
            return "workInstances.error.customTypeNotFound"
        allowed = option_values(custom_type)
        if custom_type.get("multiSelect"):
            if isinstance(value, str):
                value = [value]
            if not isinstance(value, list) or not value:
                return "workInstances.error.fieldType"
            for item in value:
                if str(item) not in allowed:
                    return "workInstances.error.customValue"
            return None
        if isinstance(value, list):
            if len(value) != 1:
                return "workInstances.error.fieldType"
            value = value[0]
        if str(value) not in allowed:
            return "workInstances.error.customValue"
        return None
    return "workInstances.error.fieldType"


def fetch_template(cur, template_id):
    cur.execute(
        'SELECT id, project_id, name, definition, created_at, updated_at'
        ' FROM "MiniPLM"."work_instance_templates" WHERE id = %s',
        (template_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    definition = row[3] if isinstance(row[3], list) else []
    return {
        "id": row[0],
        "projectId": row[1],
        "name": row[2],
        "definition": definition,
        "createdAt": row[4].isoformat() if row[4] else None,
        "updatedAt": row[5].isoformat() if row[5] else None,
    }


def normalize_fields(raw_fields, template):
    """Build the canonical field list.

    With a template: every template field is present (value from the
    request or null); unknown names are rejected. Without a template: the
    provided fields must each declare a valid type (and customType for
    custom fields).
    Returns (fields, error).
    """
    provided = {}
    if raw_fields:
        if not isinstance(raw_fields, list):
            return None, fail("workInstances.error.fields")
        for item in raw_fields:
            if not isinstance(item, dict):
                return None, fail("workInstances.error.fields")
            field_name = str(item.get("name") or "").strip()
            if not FIELD_NAME_RE.match(field_name):
                return None, fail("workInstances.error.fieldName")
            provided[field_name.lower()] = (field_name, item)

    fields = []
    if template is not None:
        for definition in template.get("definition", []):
            if not isinstance(definition, dict):
                continue
            field_name = str(definition.get("name") or "").strip()
            field_type = str(definition.get("type") or "string").strip()
            if field_type not in ALLOWED_TYPES:
                field_type = "string"
            custom_type_name = definition.get("customType")
            given = provided.get(field_name.lower())
            value = given[1].get("value") if given else None
            fields.append(
                {
                    "name": field_name,
                    "type": field_type,
                    "value": value,
                    "customType": custom_type_name,
                    "description": str(definition.get("description") or ""),
                }
            )
        for key in provided:
            if key not in [f["name"].lower() for f in fields]:
                return None, fail(
                    "workInstances.error.fieldUnknown", field=provided[key][0]
                )
        return fields, None

    for key, (field_name, item) in provided.items():
        field_type = str(item.get("type") or "").strip()
        if field_type not in ALLOWED_TYPES:
            return None, fail("workInstances.error.fieldType", field=field_name)
        value = item.get("value")
        if value is None and "value" not in item:
            continue
        fields.append(
            {
                "name": field_name,
                "type": field_type,
                "value": value,
                "customType": item.get("customType"),
                "description": str(item.get("description") or ""),
            }
        )
    return fields, None


def validate_fields(cur, fields):
    """Validate values against the declared types; return error or None."""
    for field in fields:
        field_type = field["type"]
        custom_type = None
        if field_type == "custom":
            custom_type = fetch_custom_type(cur, field.get("customType"))
            if custom_type is None:
                return fail("workInstances.error.customTypeNotFound",
                            field=field["name"])
        error = validate_field_value(field_type, field.get("value"), custom_type)
        if error:
            return fail(error, field=field["name"])
    return None


INSTANCE_SELECT = (
    "SELECT i.id, i.instance_id, i.name, i.project_id, p.name,"
    " i.work_container_id, c.identifier, c.name,"
    " i.template_id, t.name, i.progress, i.assignees, i.fields,"
    " u.login_name, u.name, u.surname, i.created_at, i.updated_at"
    ' FROM "MiniPLM"."work_instances" i'
    ' JOIN "MiniPLM"."projects" p ON p.id = i.project_id'
    ' JOIN "MiniPLM"."work_containers" c ON c.id = i.work_container_id'
    ' LEFT JOIN "MiniPLM"."work_instance_templates" t ON t.id = i.template_id'
    ' LEFT JOIN "MiniPLM"."users" u ON u.id = i.author_id'
)


def fetch_users(cur):
    cur.execute(
        'SELECT id, login_name, name, surname FROM "MiniPLM"."users"'
        " WHERE is_disabled = FALSE ORDER BY name, surname"
    )
    return [
        {"id": row[0], "loginName": row[1], "name": row[2], "surname": row[3]}
        for row in cur.fetchall()
    ]


def instance_row_to_dict(row):
    (
        instance_db_id, instance_id, name, project_id, project_name,
        container_id, container_identifier, container_name,
        template_id, template_name, progress, assignees, fields,
        author_login, author_name, author_surname, created_at, updated_at,
    ) = row
    assignee_ids = assignees if isinstance(assignees, list) else []
    return {
        "id": instance_db_id,
        "instanceId": instance_id,
        "name": name,
        "projectId": project_id,
        "projectName": project_name,
        "workContainerId": container_id,
        "workContainerIdentifier": container_identifier,
        "workContainerName": container_name,
        "templateId": template_id,
        "templateName": template_name,
        "progress": progress,
        "assigneeIds": [int(x) for x in assignee_ids],
        "fields": fields if isinstance(fields, list) else [],
        "author": (
            {"loginName": author_login, "name": author_name, "surname": author_surname}
            if author_login
            else None
        ),
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


def do_list(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    raw_container = data.get("workContainerId", data.get("work_container_id"))
    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if not modes:
            return {"ok": True, "workInstances": [], "users": [], "progressOptions": None}
        project_ids = list(modes.keys())
        placeholders = ",".join(["%s"] * len(project_ids))
        sql = f"{INSTANCE_SELECT} WHERE i.project_id IN ({placeholders})"
        params = list(project_ids)
        if raw_container not in (None, ""):
            try:
                container_id = int(raw_container)
            except (TypeError, ValueError):
                return fail("workInstances.error.containerNotFound")
            sql += " AND i.work_container_id = %s"
            params.append(container_id)
        elif raw_project not in (None, ""):
            try:
                project_id = int(raw_project)
            except (TypeError, ValueError):
                return fail("workInstances.error.projectNotFound")
            if project_id not in project_ids:
                return fail("forbidden")
            sql += " AND i.project_id = %s"
            params.append(project_id)
        sql += " ORDER BY i.id"
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        users = fetch_users(cur)
        options = progress_options(cur)
    return {
        "ok": True,
        "workInstances": [instance_row_to_dict(r) for r in rows],
        "users": users,
        "progressOptions": options,
    }


def do_create(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    try:
        project_id = int(raw_project)
    except (TypeError, ValueError):
        return fail("workInstances.error.projectNotFound")
    raw_container = data.get("workContainerId", data.get("work_container_id"))
    try:
        container_id = int(raw_container)
    except (TypeError, ValueError):
        return fail("workInstances.error.containerNotFound")
    name = str(data.get("name") or "").strip()
    if not NAME_RE.match(name):
        return fail("workInstances.error.nameFormat")

    template = None
    raw_template = data.get("templateId", data.get("template_id"))
    if raw_template not in (None, ""):
        try:
            template_id = int(raw_template)
        except (TypeError, ValueError):
            return fail("workInstances.error.templateNotFound")

    progress_value = str(data.get("progress") or "").strip() or None
    assignee_ids = data.get("assignees", data.get("assigneeIds"))
    if assignee_ids is None:
        assignee_ids = []
    if not isinstance(assignee_ids, list):
        return fail("workInstances.error.assignees")

    with ctx.POSTGRESQL.cursor() as cur:
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "C" not in modes.get(project_id, set()):
            return fail("forbidden")
        cur.execute(
            'SELECT id, project_id FROM "MiniPLM"."work_containers" WHERE id = %s',
            (container_id,),
        )
        container_row = cur.fetchone()
        if not container_row or container_row[1] != project_id:
            return fail("workInstances.error.containerNotFound")
        if raw_template not in (None, ""):
            template = fetch_template(cur, template_id)
            if template is None or template["projectId"] != project_id:
                return fail("workInstances.error.templateNotFound")

        fields, error = normalize_fields(data.get("fields"), template)
        if error is not None:
            return error
        error = validate_fields(cur, fields)
        if error is not None:
            return error

        if assignee_ids:
            placeholders = ",".join(["%s"] * len(assignee_ids))
            cur.execute(
                f"SELECT id FROM \"MiniPLM\".\"users\" WHERE id IN ({placeholders})"
                " AND is_disabled = FALSE",
                tuple(int(x) for x in assignee_ids),
            )
            found = {row[0] for row in cur.fetchall()}
            for uid in assignee_ids:
                if int(uid) not in found:
                    return fail("workInstances.error.assignees")

        options = progress_options(cur)
        error = validate_progress(progress_value, options)
        if error:
            return fail(error)

        cur.execute(
            'INSERT INTO "MiniPLM"."work_instances"'
            " (instance_id, project_id, work_container_id, name, author_id,"
            "  progress, assignees, template_id, fields)"
            " VALUES ('WI-PENDING', %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                project_id,
                container_id,
                name,
                session.get("userId"),
                progress_value,
                json.dumps([int(x) for x in assignee_ids]),
                template["id"] if template else None,
                json.dumps(fields),
            ),
        )
        cur.execute(
            'SELECT currval(%s::regclass)',
            ('"MiniPLM".work_instances_id_seq',),
        )
        instance_db_id = cur.fetchone()[0]
        instance_identifier = f"WI-{instance_db_id:06d}"
        cur.execute(
            'UPDATE "MiniPLM"."work_instances" SET instance_id = %s WHERE id = %s',
            (instance_identifier, instance_db_id),
        )
    ctx.POSTGRESQL.commit()
    return do_get_by_db_id(ctx, session, instance_db_id)


def do_get_by_db_id(ctx, session, instance_db_id):
    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(f"{INSTANCE_SELECT} WHERE i.id = %s", (instance_db_id,))
        row = cur.fetchone()
        if not row:
            return fail("workInstances.error.notFound")
        instance = instance_row_to_dict(row)
        cur.execute(
            'SELECT id, login_name, name, surname FROM "MiniPLM"."users"'
            " WHERE id = ANY(%s)",
            (instance["assigneeIds"],),
        )
        users = cur.fetchall()
    instance["assignees"] = [
        {"id": r[0], "loginName": r[1], "name": r[2], "surname": r[3]}
        for r in users
    ]
    return {"ok": True, "workInstance": instance}


def resolve_db_id(cur, raw_id):
    if isinstance(raw_id, str) and raw_id.strip().upper().startswith("WI-"):
        cur.execute(
            'SELECT id FROM "MiniPLM"."work_instances" WHERE instance_id = %s',
            (raw_id.strip(),),
        )
    else:
        try:
            db_id = int(raw_id)
        except (TypeError, ValueError):
            return None
        cur.execute(
            'SELECT id FROM "MiniPLM"."work_instances" WHERE id = %s', (db_id,)
        )
    row = cur.fetchone()
    return row[0] if row else None


def do_get(ctx, session, data):
    raw_id = data.get("id", data.get("instanceId", data.get("instance_id")))
    with ctx.POSTGRESQL.cursor() as cur:
        db_id = resolve_db_id(cur, raw_id)
    if db_id is None:
        return fail("workInstances.error.notFound")
    return do_get_by_db_id(ctx, session, db_id)


def do_update(ctx, session, data):
    raw_id = data.get("id", data.get("instanceId", data.get("instance_id")))
    with ctx.POSTGRESQL.cursor() as cur:
        instance_db_id = resolve_db_id(cur, raw_id)
        if instance_db_id is None:
            return fail("workInstances.error.notFound")
        cur.execute(
            'SELECT i.project_id, i.name, i.progress, i.assignees, i.fields,'
            ' i.template_id FROM "MiniPLM"."work_instances" i WHERE i.id = %s',
            (instance_db_id,),
        )
        row = cur.fetchone()
        project_id, current_name, current_progress, current_assignees, current_fields, template_id = row
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "U" not in modes.get(project_id, set()):
            return fail("forbidden")

        template = fetch_template(cur, template_id) if template_id else None
        current_fields = current_fields if isinstance(current_fields, list) else []

        new_name = str(data.get("name") or "").strip() or current_name
        if not NAME_RE.match(new_name):
            return fail("workInstances.error.nameFormat")

        if "fields" in data:
            fields, error = normalize_fields(data["fields"], template)
            if error is not None:
                return error
            if template is None:
                stated = {f["name"].lower() for f in fields}
                for existing in current_fields:
                    if existing["name"].lower() not in stated:
                        fields.append(existing)
            merged = fields
        else:
            merged = current_fields
        error = validate_fields(cur, merged)
        if error is not None:
            return error

        progress_value = current_progress
        if "progress" in data:
            progress_value = str(data.get("progress") or "").strip() or None
            options = progress_options(cur)
            error = validate_progress(progress_value, options)
            if error:
                return fail(error)

        assignees = (
            [int(x) for x in current_assignees]
            if isinstance(current_assignees, list)
            else []
        )
        if "assignees" in data or "assigneeIds" in data:
            new_assignees = data.get("assignees", data.get("assigneeIds")) or []
            if not isinstance(new_assignees, list):
                return fail("workInstances.error.assignees")
            if new_assignees:
                placeholders = ",".join(["%s"] * len(new_assignees))
                cur.execute(
                    f"SELECT id FROM \"MiniPLM\".\"users\""
                    f" WHERE id IN ({placeholders}) AND is_disabled = FALSE",
                    tuple(int(x) for x in new_assignees),
                )
                found = {r[0] for r in cur.fetchall()}
                for uid in new_assignees:
                    if int(uid) not in found:
                        return fail("workInstances.error.assignees")
            assignees = [int(x) for x in new_assignees]

        cur.execute(
            'UPDATE "MiniPLM"."work_instances"'
            " SET name = %s, progress = %s, assignees = %s, fields = %s,"
            "     updated_at = now()"
            " WHERE id = %s",
            (
                new_name,
                progress_value,
                json.dumps(assignees),
                json.dumps(merged),
                instance_db_id,
            ),
        )
    ctx.POSTGRESQL.commit()
    return do_get_by_db_id(ctx, session, instance_db_id)


def do_delete(ctx, session, data):
    raw_id = data.get("id", data.get("instanceId", data.get("instance_id")))
    with ctx.POSTGRESQL.cursor() as cur:
        db_id = resolve_db_id(cur, raw_id)
        if db_id is None:
            return fail("workInstances.error.notFound")
        cur.execute(
            'SELECT project_id FROM "MiniPLM"."work_instances" WHERE id = %s',
            (db_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workInstances.error.notFound")
        modes = accessible_project_modes(cur, session.get("userId"))
        if row[0] not in modes or "D" not in modes.get(row[0], set()):
            return fail("forbidden")
        cur.execute('DELETE FROM "MiniPLM"."work_instances" WHERE id = %s', (db_id,))
    ctx.POSTGRESQL.commit()
    return {"ok": True, "deleted": raw_id}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Work instances not configured"}

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
        if operation in ("list", "list-work-instances"):
            return do_list(ctx, session, data)
        if operation in ("get", "get-work-instance"):
            return do_get(ctx, session, data)
        if operation in ("create", "create-work-instance"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_create(ctx, session, data)
        if operation in ("update", "update-work-instance"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_update(ctx, session, data)
        if operation in ("delete", "delete-work-instance"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_delete(ctx, session, data)
        return fail("workInstances.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("workInstances.error.request", detail=str(exc))
