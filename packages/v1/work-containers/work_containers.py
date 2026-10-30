"""MiniPLM work containers.

A work container is an entity with a unique identifier (WC-000001 style),
title, author, template fields, progress, description,
created/updated timestamps and a full history of the users who created or
modified it (with dates and changed fields). Zero or more work instances
can be linked to a work container.

Containers follow work instance templates (the same shared library):
the template lists the allowed fields, and a "progress" field of the
template selects the workflow progress type that drives the container
progress (initial state on create, role-filtered transitions on update).
Without a progress field there is no progress.

Access: valid Redis session + an enabled group attached to the project.
Group access modes gate the operations: read (any mode), create ``C``,
update ``U``, delete ``D``.
"""

import json
import re
import time
import xml.etree.ElementTree as ElementTree

FIELD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 _-]{0,63}$")
ALLOWED_TYPES = ("number", "date", "string", "attachment", "html", "md", "xml", "custom", "progress")
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


def workflow_type_descriptor(cur, type_name):
    """Full descriptor of a workflow progress type by name, or None.

    Returns {options, transitions, initialState} for an enabled
    workflow-category custom type; disabled or missing types resolve to
    None so that a template progress field degrades gracefully.
    """
    name = str(type_name or "").strip()
    if not name:
        return None
    cur.execute(
        'SELECT options, initial_state, transitions FROM "MiniPLM"."custom_types"'
        " WHERE lower(name) = lower(%s) AND category = 'workflow'"
        " AND is_disabled = FALSE",
        (name,),
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


def template_progress_workflow(cur, template):
    """Progress workflow of the template's progress field, or None.

    The template definition may carry at most one field of type
    "progress"; its customType references the workflow progress type.
    The workflow applies automatically: there is no global designation.
    Without a progress field the container has no progress at all.
    """
    if not isinstance(template, dict):
        return None
    for entry in template.get("definition") or []:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("type") or "").strip().lower() == "progress":
            return workflow_type_descriptor(cur, entry.get("customType"))
    return None


def template_progress_options(cur, template):
    """Options of the template progress workflow, or None (no progress)."""
    workflow = template_progress_workflow(cur, template)
    if workflow is None:
        return None
    return [o for o in workflow["options"]]


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


def validate_progress_change(
    cur, session, current_progress, new_value, on_create=False, workflow=None
):
    """Apply the workflow transition rules to a progress value.

    The workflow is the descriptor of the progress type referenced by the
    container's template (there is no global designation). On create:
    when the workflow defines transitions, a new object must start from
    its initial state (or leave the progress empty). On update: the new
    state must be reachable from the current state by a transition, and
    the user must hold the role the transition requires (a null role
    means any user). A null workflow means the container has no progress
    field: a non-empty value is rejected by the caller.
    """
    value = str(new_value or "").strip()
    if not value:
        return None
    if workflow is None:
        return fail("workContainers.error.progressNotInTemplate")
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
    """Validate one field value; return None or a shared error key.

    Mirrors the work instance field validation: containers carry the same
    template fields, so the same (shared) error keys apply.
    """
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
    if field_type in ("string", "html", "md"):
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


def normalize_fields(raw_fields, template):
    """Build the canonical field list for a container. Fields are defined
    only by the template (the ad-hoc field path is gone); the progress
    field is excluded: it lives in its own column, driven by the template's
    workflow progress type. Returns (fields, error).
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
    if template is None:
        # Fields exist only inside a template: with no template no field
        # can be defined (creation requires a template; updates of legacy
        # template-less rows send no fields and keep the stored ones).
        if provided:
            return None, fail("workContainers.error.templateRequired")
        return fields, None

    for definition in template.get("definition", []):
        if not isinstance(definition, dict):
            continue
        if str(definition.get("type") or "").strip() == "progress":
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


def container_row_to_dict(row):
    (
        container_id,
        identifier,
        project_id,
        project_name,
        workspace_id,
        workspace_name,
        title,
        description,
        progress,
        template_id,
        template_name,
        template_icon,
        fields,
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
        "title": title,
        "description": description,
        "progress": progress,
        "progressWorkflow": None,
        "templateId": template_id,
        "templateName": template_name,
        "templateIconName": str(template_icon).strip() if template_icon else None,
        "fields": fields if isinstance(fields, list) else [],
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
    " c.title, c.description, c.progress,"
    " c.template_id, t.name, t.icon_name, c.fields,"
    " u.login_name, u.name, u.surname, c.created_at, c.updated_at,"
    " (SELECT COUNT(*) FROM \"MiniPLM\".\"work_instances\" wi"
    "  WHERE wi.work_container_id = c.id) AS instance_count"
    ' FROM "MiniPLM"."work_containers" c'
    ' JOIN "MiniPLM"."projects" p ON p.id = c.project_id'
    ' LEFT JOIN "MiniPLM"."workspaces" ws ON ws.id = c.workspace_id'
    ' LEFT JOIN "MiniPLM"."work_instance_templates" t ON t.id = c.template_id'
    ' LEFT JOIN "MiniPLM"."users" u ON u.id = c.author_id'
)


def attach_progress_workflows(cur, containers):
    """Attach the per-container progress workflow (resolved from the
    container's template) so the UI can offer only the states reachable
    from the current state for the user's roles."""
    template_cache = {}
    for container in containers:
        template_id = container.get("templateId")
        if template_id is None:
            container["progressWorkflow"] = None
            continue
        if template_id not in template_cache:
            template_cache[template_id] = fetch_template(cur, template_id)
        container["progressWorkflow"] = template_progress_workflow(
            cur, template_cache[template_id]
        )
        container["fields"] = order_fields_by_template(
            container.get("fields"), template_cache[template_id]
        )


def order_fields_by_template(fields, template):
    """Order the stored field entries by the template definition so the
    forms and detail views render the fields in the order chosen in the
    template editor. Fields that are not part of the template (ad-hoc
    fields) keep their relative order after the template fields."""
    if not isinstance(fields, list) or not isinstance(template, dict):
        return fields
    definition = template.get("definition") or []
    positions = {}
    for pos, entry in enumerate(definition):
        if isinstance(entry, dict):
            name = str(entry.get("name") or "").lower()
            if name and name not in positions:
                positions[name] = pos

    def sort_key(pair):
        idx, field = pair
        name = str(field.get("name") or "").lower() if isinstance(field, dict) else ""
        if name in positions:
            return (0, positions[name], idx)
        return (1, 0, idx)

    return [field for _, field in sorted(enumerate(fields), key=sort_key)]


def attach_container_progress_workflow(cur, container):
    """Single-row counterpart of attach_progress_workflows: resolve the
    progress workflow of the container's template, when present."""
    template_id = container.get("templateId")
    if template_id is None:
        container["progressWorkflow"] = None
        return
    template = fetch_template(cur, template_id)
    if template is None:
        container["progressWorkflow"] = None
        return
    container["progressWorkflow"] = template_progress_workflow(
        cur, template
    )
    container["fields"] = order_fields_by_template(
        container.get("fields"), template
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
        user_roles = user_role_names(cur, session.get("userId"))
        containers = [container_row_to_dict(r) for r in rows]
        attach_progress_workflows(cur, containers)
    return {
        "ok": True,
        "workContainers": containers,
        "userRoles": user_roles,
    }


def do_create(ctx, session, data):
    raw_project = data.get("projectId", data.get("project_id"))
    try:
        project_id = int(raw_project)
    except (TypeError, ValueError):
        return fail("workContainers.error.projectNotFound")

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
    raw_template = data.get("templateId", data.get("template_id"))
    if raw_template in (None, ""):
        # Work containers always use a template: fields (and the optional
        # progress workflow) come from the template definition.
        return fail("workContainers.error.templateRequired")
    try:
        template_id = int(raw_template)
    except (TypeError, ValueError):
        return fail("workContainers.error.templateNotFound")

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
        template = fetch_template(cur, template_id)
        if template is None or template["projectId"] != project_id:
            return fail("workContainers.error.templateNotFound")
        fields, error = normalize_fields(data.get("fields"), template)
        if error is not None:
            return error
        error = validate_fields(cur, fields)
        if error is not None:
            return error
        workflow = template_progress_workflow(cur, template)
        if progress_value:
            if workflow is None:
                return fail("workContainers.error.progressNotInTemplate")
            error = validate_progress(progress_value, workflow["options"])
            if error:
                return fail(error)
            error = validate_progress_change(
                cur, session, None, progress_value,
                on_create=True, workflow=workflow,
            )
            if error:
                return fail(error)
        cur.execute(
            'INSERT INTO "MiniPLM"."work_containers"'
            " (identifier, project_id, workspace_id, title, description,"
            "  progress, author_id, template_id, fields)"
            " VALUES ('WC-PENDING', %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                project_id,
                workspace_id,
                str(data.get("title") or "").strip() or None,
                str(data.get("description") or "").strip() or None,
                progress_value,
                session.get("userId"),
                template_id,
                json.dumps(fields),
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
                json.dumps(
                    ["title", "description", "template", "fields", "progress"]
                ),
            ),
        )
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(f"{CONTAINER_SELECT} WHERE c.id = %s", (container_id,))
        row = cur.fetchone()
        container = container_row_to_dict(row)
        attach_container_progress_workflow(cur, container)
    return {"ok": True, "workContainer": container}


def do_update(ctx, session, data):
    raw_id = data.get("id", data.get("workContainerId", data.get("work_container_id")))
    try:
        container_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("workContainers.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT c.project_id, c.title, c.description, c.progress,'
            ' c.template_id, c.fields FROM "MiniPLM"."work_containers" c'
            ' WHERE c.id = %s',
            (container_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("workContainers.error.notFound")
        (
            project_id, current_title, current_description,
            current_progress, current_template_id, current_fields,
        ) = row
        modes = accessible_project_modes(cur, session.get("userId"))
        if project_id not in modes or "U" not in modes.get(project_id, set()):
            return fail("forbidden")

        template = fetch_template(cur, current_template_id) if current_template_id else None
        current_fields = current_fields if isinstance(current_fields, list) else []

        changed = []
        # An absent/empty title keeps the current value (update is partial).
        title = str(data.get("title") or "").strip() or current_title
        if title != current_title:
            changed.append("title")
        # An absent/empty description keeps the current value (partial update).
        description = str(data.get("description") or "").strip() or current_description
        if description != current_description:
            changed.append("description")

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
        if json.dumps(merged) != json.dumps(current_fields):
            changed.append("fields")

        progress_value = current_progress
        if "progress" in data:
            progress_value = str(data.get("progress") or "").strip() or None
            # The value already stored is kept as-is (legacy rows may
            # carry a progress written before the progress field moved
            # into the template). Only a real change is validated against
            # the template workflow; clearing the value is always allowed.
            if progress_value != current_progress and progress_value:
                workflow = template_progress_workflow(cur, template)
                if workflow is None:
                    return fail("workContainers.error.progressNotInTemplate")
                error = validate_progress(progress_value, workflow["options"])
                if error:
                    return fail(error)
                error = validate_progress_change(
                    cur, session, current_progress, progress_value,
                    workflow=workflow,
                )
                if error:
                    return fail(error)
            if progress_value != current_progress:
                changed.append("progress")
        if not changed:
            return fail("workContainers.error.noChange")

        cur.execute(
            'UPDATE "MiniPLM"."work_containers"'
            " SET title = %s, description = %s, progress = %s,"
            "     fields = %s, updated_at = now()"
            " WHERE id = %s",
            (
                title, description, progress_value,
                json.dumps(merged), container_id,
            ),
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
        container = container_row_to_dict(row)
        attach_container_progress_workflow(cur, container)
    return {"ok": True, "workContainer": container}


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
