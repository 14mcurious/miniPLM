"""MiniPLM custom types (admin only).

Custom types are enumerated types based on number, date or string values,
with single or multi select semantics. They are managed in the
Configuration area of the system:

- category "standard": used by work instance fields of type custom;
- category "workflow": used for progress values of work containers and
  work instances. One workflow type can be designated as the progress type
  (setting workflow_progress_type).

Requires a valid Redis session AND the SysAdmin role on every request.
"""

import json
import re
import time

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]{0,79}$")
VALUE_TYPES = ("number", "date", "string")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_OPTIONS = 200
SYSADMIN_GROUP = "SysAdmin"
ROLE_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ]{0,49}$")
MAX_ROLE_LIST_SIZE = 50


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


def user_is_sysadmin(cur, user_id):
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."user_groups" ug'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.name = %s AND g.is_disabled = FALSE",
        (user_id, SYSADMIN_GROUP),
    )
    return cur.fetchone() is not None


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


def validate_options(value_type, raw_options):
    """Normalize and validate the enumerated option values."""
    # Options carry exactly two fields: label and value.
    if raw_options is None:
        raw_options = []
    if not isinstance(raw_options, list):
        return None, fail("customTypes.error.options")
    if len(raw_options) > MAX_OPTIONS:
        return None, fail("customTypes.error.optionsTooMany", max=MAX_OPTIONS)
    options = []
    seen = set()
    for item in raw_options:
        if not isinstance(item, dict):
            return None, fail("customTypes.error.options")
        value = str(item.get("value") or "").strip()
        if not value or len(value) > 200:
            return None, fail("customTypes.error.optionValue")
        if value_type == "number":
            try:
                float(value)
            except ValueError:
                return None, fail("customTypes.error.optionValue")
        if value_type == "date" and not DATE_RE.match(value):
            return None, fail("customTypes.error.optionValue")
        if value in seen:
            return None, fail("customTypes.error.optionDuplicate")
        seen.add(value)
        label = str(item.get("label") or value).strip() or value
        options.append({"label": label[:200], "value": value})
    return options, None


def custom_type_to_dict(row):
    (
        type_id,
        name,
        value_type,
        multi_select,
        category,
        options,
        is_disabled,
        created_at,
        updated_at,
        initial_state,
        transitions,
        role_list_id,
        role_list_name,
    ) = row
    return {
        "id": type_id,
        "name": name,
        "valueType": value_type,
        "multiSelect": bool(multi_select),
        "category": category,
        "options": options if isinstance(options, list) else [],
        "isDisabled": bool(is_disabled),
        "initialState": initial_state if isinstance(initial_state, str) else None,
        "transitions": transitions if isinstance(transitions, list) else [],
        "roleListId": role_list_id if isinstance(role_list_id, int) else None,
        "roleListName": role_list_name if isinstance(role_list_name, str) else None,
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


def role_to_dict(row):
    role_id, name, created_at, updated_at = row
    return {
        "id": role_id,
        "name": name,
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


def role_list_to_dict(row, members):
    list_id, name, created_at, updated_at = row
    return {
        "id": list_id,
        "name": name,
        "members": members if isinstance(members, list) else [],
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


def validate_transitions(option_values, raw_transitions, role_names):
    """Normalize and validate the workflow state transitions.

    Transitions are {from, to, role} pairs referencing existing option values.
    role is optional (null = any user); if present, must be in role_names.
    Duplicates are dropped; invalid references are rejected.
    """
    if raw_transitions is None:
        raw_transitions = []
    if not isinstance(raw_transitions, list):
        return None, fail("customTypes.error.transitions")
    valid = set(option_values)
    role_set = set(role_names) if role_names else set()
    transitions = []
    seen = set()
    for item in raw_transitions:
        if not isinstance(item, dict):
            return None, fail("customTypes.error.transitions")
        src = str(item.get("from") or "").strip()
        dst = str(item.get("to") or "").strip()
        role = item.get("role")
        if role is not None:
            role = str(role).strip()
        if not src or not dst:
            return None, fail("customTypes.error.transitionValue")
        if src not in valid or dst not in valid:
            return None, fail("customTypes.error.transitionValue")
        if role is not None and role not in role_set:
            return None, fail("customTypes.error.transitionRole")
        key = (src, dst, role)
        if key in seen:
            continue
        seen.add(key)
        transitions.append({"from": src, "to": dst, "role": role})
    return transitions, None


def validate_initial_state(option_values, raw_initial):
    """Validate the initial state value (must be one of the options)."""
    if raw_initial is None or raw_initial == "":
        return None, None
    initial = str(raw_initial).strip()
    if initial not in option_values:
        return None, fail("customTypes.error.initialState")
    return initial, None


def do_list(ctx, session):
    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT ct.id, ct.name, ct.value_type, ct.multi_select, ct.category, ct.options,'
            ' ct.is_disabled, ct.created_at, ct.updated_at, ct.initial_state, ct.transitions,'
            ' ct.role_list_id, rl.name'
            ' FROM "MiniPLM"."custom_types" ct'
            ' LEFT JOIN "MiniPLM"."role_lists" rl ON rl.id = ct.role_list_id'
            " ORDER BY ct.category, ct.name COLLATE \"C\""
        )
        rows = cur.fetchall()
        cur.execute(
            'SELECT value FROM "MiniPLM"."settings"'
            " WHERE key = 'workflow_progress_type'"
        )
        setting = cur.fetchone()
        progress_type_name = (setting[0] if setting else "").strip()
        # Roles with their members (user info)
        cur.execute(
            'SELECT r.id, r.name, r.created_at, r.updated_at,'
            ' ur.user_id, u.login_name, u.name, u.surname'
            ' FROM "MiniPLM"."roles" r'
            ' LEFT JOIN "MiniPLM"."user_roles" ur ON ur.role_id = r.id'
            ' LEFT JOIN "MiniPLM"."users" u ON u.id = ur.user_id'
            ' ORDER BY r.name COLLATE \"C\", u.login_name'
        )
        role_rows = cur.fetchall()
        roles_dict = {}
        for row in role_rows:
            rid, rname, rcreated, rupdated, uid, ulogin, uname, usurname = row
            if rid not in roles_dict:
                roles_dict[rid] = {
                    "id": rid,
                    "name": rname,
                    "createdAt": rcreated.isoformat() if rcreated else None,
                    "updatedAt": rupdated.isoformat() if rupdated else None,
                    "members": [],
                }
            if uid:
                roles_dict[rid]["members"].append({
                    "id": uid,
                    "loginName": ulogin,
                    "name": uname,
                    "surname": usurname,
                })
        roles = list(roles_dict.values())
        # Role lists with their members (role info)
        cur.execute(
            'SELECT rl.id, rl.name, rl.created_at, rl.updated_at,'
            ' rlm.role_id, r.name'
            ' FROM "MiniPLM"."role_lists" rl'
            ' LEFT JOIN "MiniPLM"."role_list_members" rlm ON rlm.role_list_id = rl.id'
            ' LEFT JOIN "MiniPLM"."roles" r ON r.id = rlm.role_id'
            ' ORDER BY rl.name COLLATE \"C\", r.name'
        )
        rl_rows = cur.fetchall()
        role_lists_dict = {}
        for row in rl_rows:
            rlid, rlname, rlcreated, rlupdated, rid, rname = row
            if rlid not in role_lists_dict:
                role_lists_dict[rlid] = {
                    "id": rlid,
                    "name": rlname,
                    "members": [],
                    "createdAt": rlcreated.isoformat() if rlcreated else None,
                    "updatedAt": rlupdated.isoformat() if rlupdated else None,
                }
            if rid:
                role_lists_dict[rlid]["members"].append({
                    "id": rid,
                    "name": rname,
                })
        role_lists = list(role_lists_dict.values())
    return {
        "ok": True,
        "customTypes": [custom_type_to_dict(r) for r in rows],
        "workflowProgressType": progress_type_name or None,
        "roles": roles,
        "roleLists": role_lists,
    }


def do_create(ctx, session, data):
    name = str(data.get("name") or "").strip()
    if not NAME_RE.match(name):
        return fail("customTypes.error.nameFormat")
    value_type = str(data.get("valueType", data.get("value_type")) or "string").strip().lower()
    if value_type not in VALUE_TYPES:
        return fail("customTypes.error.valueType")
    category = str(data.get("category") or "standard").strip().lower()
    if category not in ("standard", "workflow"):
        return fail("customTypes.error.category")
    multi_select = bool(data.get("multiSelect", data.get("multi_select")))

    with ctx.POSTGRESQL.cursor() as cur:
        options, error = validate_options(value_type, data.get("options"))
        if error is not None:
            return error
        option_values = [opt["value"] for opt in options]
        initial_state, error = validate_initial_state(
            option_values, data.get("initialState", data.get("initial_state"))
        )
        if error is not None:
            return error
        # Get role list and role names for transition validation
        role_list_id = None
        role_names = []
        raw_role_list_id = data.get("roleListId", data.get("role_list_id"))
        if raw_role_list_id:
            try:
                role_list_id = int(raw_role_list_id)
            except (TypeError, ValueError):
                return fail("customTypes.error.roleList")
            cur.execute(
                'SELECT id FROM "MiniPLM"."role_lists" WHERE id = %s',
                (role_list_id,),
            )
            if not cur.fetchone():
                return fail("customTypes.error.roleList")
            cur.execute(
                'SELECT r.name FROM "MiniPLM"."role_list_members" rlm'
                ' JOIN "MiniPLM"."roles" r ON r.id = rlm.role_id'
                ' WHERE rlm.role_list_id = %s',
                (role_list_id,),
            )
            role_names = [row[0] for row in cur.fetchall()]
        transitions, error = validate_transitions(
            option_values, data.get("transitions"), role_names
        )
        if error is not None:
            return error
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."custom_types" WHERE lower(name) = lower(%s)',
            (name,),
        )
        if cur.fetchone():
            return fail("customTypes.error.nameTaken")
        cur.execute(
            'INSERT INTO "MiniPLM"."custom_types"'
            " (name, value_type, multi_select, category, options, is_disabled,"
            "  initial_state, transitions, role_list_id)"
            " VALUES (%s, %s, %s, %s, %s, FALSE, %s, %s, %s)",
            (
                name,
                value_type,
                multi_select,
                category,
                json.dumps(options),
                initial_state,
                json.dumps(transitions),
                role_list_id,
            ),
        )
        cur.execute(
            'SELECT currval(%s::regclass)', ('"MiniPLM".custom_types_id_seq',)
        )
        type_id = cur.fetchone()[0]
    

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT id, name, value_type, multi_select, category, options,'
            ' is_disabled, created_at, updated_at, initial_state, transitions,'
            ' role_list_id, NULL'
            ' FROM "MiniPLM"."custom_types"'
            " WHERE id = %s",
            (type_id,),
        )
        row = cur.fetchone()
    return {"ok": True, "customType": custom_type_to_dict(row)}


def set_progress_type(ctx, data):
    """Designate (or clear) the workflow progress type by name."""
    raw_name = data.get("name", data.get("customTypeName"))
    type_name = str(raw_name or "").strip()
    with ctx.POSTGRESQL.cursor() as cur:
        if type_name:
            cur.execute(
                'SELECT name, category FROM "MiniPLM"."custom_types"'
                " WHERE lower(name) = lower(%s)",
                (type_name,),
            )
            row = cur.fetchone()
            if not row:
                return fail("customTypes.error.notFound")
            if row[1] != "workflow":
                return fail("customTypes.error.progressTypeCategory")
        cur.execute(
            'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            ("workflow_progress_type", type_name),
        )
    
    return {"ok": True, "workflowProgressType": type_name or None}


def do_update(ctx, session, data):
    raw_id = data.get("id")
    try:
        type_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT id, name, value_type, multi_select, category, options,'
            ' initial_state, transitions, role_list_id, NULL'
            ' FROM "MiniPLM"."custom_types" WHERE id = %s',
            (type_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("customTypes.error.notFound")
        (
            _,
            current_name,
            current_value_type,
            current_multi,
            current_category,
            current_options,
            current_initial_state,
            current_transitions,
            current_role_list_id,
            current_role_list_name,
        ) = row

        name = str(data.get("name") or "").strip() or current_name
        if not NAME_RE.match(name):
            return fail("customTypes.error.nameFormat")
        value_type = (
            str(data.get("valueType", data.get("value_type")) or "").strip().lower()
            or current_value_type
        )
        if value_type not in VALUE_TYPES:
            return fail("customTypes.error.valueType")
        category = str(data.get("category") or current_category).strip().lower()
        if category not in ("standard", "workflow"):
            return fail("customTypes.error.category")
        multi_select = bool(
            data.get("multiSelect", data.get("multi_select", current_multi))
        )
        options = None
        if "options" in data:
            options, error = validate_options(value_type, data["options"])
            if error is not None:
                return error
        if options is None:
            options = current_options if isinstance(current_options, list) else []
        option_values = [opt["value"] for opt in options]

        # Initial state: defaults to the current value; cleared if the
        # option it referenced was removed.
        if "initialState" in data or "initial_state" in data:
            initial_state, error = validate_initial_state(
                option_values,
                data.get("initialState", data.get("initial_state")),
            )
            if error is not None:
                return error
        else:
            initial_state = (
                current_initial_state
                if current_initial_state in option_values
                else None
            )

        # Transitions: defaults to the current ones, pruned of references
        # to option values that no longer exist.
        # Get role list and role names for transition validation
        role_list_id = current_role_list_id
        role_names = []
        if "roleListId" in data or "role_list_id" in data:
            raw_role_list_id = data.get("roleListId", data.get("role_list_id"))
            if raw_role_list_id:
                try:
                    role_list_id = int(raw_role_list_id)
                except (TypeError, ValueError):
                    return fail("customTypes.error.roleList")
                cur.execute(
                    'SELECT id FROM "MiniPLM"."role_lists" WHERE id = %s',
                    (role_list_id,),
                )
                if not cur.fetchone():
                    return fail("customTypes.error.roleList")
                cur.execute(
                    'SELECT r.name FROM "MiniPLM"."role_list_members" rlm'
                    ' JOIN "MiniPLM"."roles" r ON r.id = rlm.role_id'
                    ' WHERE rlm.role_list_id = %s',
                    (role_list_id,),
                )
                role_names = [row[0] for row in cur.fetchall()]
            else:
                role_list_id = None
        if "transitions" in data:
            transitions, error = validate_transitions(
                option_values, data.get("transitions"), role_names
            )
            if error is not None:
                return error
        else:
            raw_current = (
                current_transitions
                if isinstance(current_transitions, list)
                else []
            )
            # Prune invalid transitions and roles
            transitions = []
            for t in raw_current:
                if not isinstance(t, dict):
                    continue
                if t.get("from") not in option_values or t.get("to") not in option_values:
                    continue
                role = t.get("role")
                if role is not None and role not in role_names:
                    continue
                transitions.append({"from": t["from"], "to": t["to"], "role": role})

        if name != current_name:
            cur.execute(
                'SELECT 1 FROM "MiniPLM"."custom_types"'
                " WHERE lower(name) = lower(%s) AND id <> %s",
                (name, type_id),
            )
            if cur.fetchone():
                return fail("customTypes.error.nameTaken")

        is_disabled = bool(data.get("isDisabled", data.get("is_disabled")))
        if is_disabled:
            cur.execute(
                'SELECT value FROM "MiniPLM"."settings"'
                " WHERE key = 'workflow_progress_type'"
            )
            setting = cur.fetchone()
            progress_name = (setting[0] if setting else "").strip()
            if progress_name and progress_name.lower() == name.lower():
                cur.execute(
                    'UPDATE "MiniPLM"."settings" SET value = %s'
                    " WHERE key = 'workflow_progress_type'",
                    ("",),
                )
        cur.execute(
            'UPDATE "MiniPLM"."custom_types"'
            " SET name = %s, value_type = %s, multi_select = %s,"
            "     category = %s, options = %s, is_disabled = %s,"
            "     initial_state = %s, transitions = %s, role_list_id = %s,"
            "     updated_at = now()"
            " WHERE id = %s",
            (
                name,
                value_type,
                multi_select,
                category,
                json.dumps(options),
                is_disabled,
                initial_state,
                json.dumps(transitions),
                role_list_id,
                type_id,
            ),
        )
    

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT id, name, value_type, multi_select, category, options,'
            ' is_disabled, created_at, updated_at, initial_state, transitions,'
            ' role_list_id, NULL'
            ' FROM "MiniPLM"."custom_types"'
            " WHERE id = %s",
            (type_id,),
        )
        row = cur.fetchone()
    return {"ok": True, "customType": custom_type_to_dict(row)}


def do_delete(ctx, session, data):
    raw_id = data.get("id")
    try:
        type_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT name FROM "MiniPLM"."custom_types" WHERE id = %s',
            (type_id,),
        )
        row = cur.fetchone()
        if not row:
            return fail("customTypes.error.notFound")
        type_name = row[0]
        cur.execute(
            'SELECT value FROM "MiniPLM"."settings"'
            " WHERE key = 'workflow_progress_type'"
        )
        setting = cur.fetchone()
        progress_name = (setting[0] if setting else "").strip()
        if progress_name and progress_name.lower() == type_name.lower():
            return fail("customTypes.error.inUse", field="workflowProgressType")
        cur.execute(
            'SELECT definition FROM "MiniPLM"."work_instance_templates"'
        )
        for (definition,) in cur.fetchall():
            fields = definition if isinstance(definition, list) else []
            for field in fields:
                if (
                    isinstance(field, dict)
                    and str(field.get("customType") or "").lower()
                    == type_name.lower()
                ):
                    return fail("customTypes.error.inUse", field="template")
        cur.execute(
            'DELETE FROM "MiniPLM"."custom_types" WHERE id = %s', (type_id,)
        )
    
    return {"ok": True, "deleted": type_id}


# Role operations
def do_create_role(ctx, cur, data):
    name = str(data.get("name") or "").strip()
    if not ROLE_NAME_RE.match(name):
        return fail("customTypes.error.roleNameFormat")
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."roles" WHERE lower(name) = lower(%s)',
        (name,),
    )
    if cur.fetchone():
        return fail("customTypes.error.roleNameTaken")
    cur.execute(
        'INSERT INTO "MiniPLM"."roles" (name) VALUES (%s)',
        (name,),
    )
    cur.execute('SELECT id FROM "MiniPLM"."roles" WHERE lower(name) = lower(%s)', (name,))
    role_id = cur.fetchone()[0]
    
    return {"ok": True, "roleId": role_id, "name": name}


def do_update_role(ctx, cur, data):
    raw_id = data.get("id")
    try:
        role_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")
    cur.execute('SELECT id, name FROM "MiniPLM"."roles" WHERE id = %s', (role_id,))
    row = cur.fetchone()
    if not row:
        return fail("customTypes.error.notFound")
    _, current_name = row
    name = str(data.get("name") or "").strip() or current_name
    if not ROLE_NAME_RE.match(name):
        return fail("customTypes.error.roleNameFormat")
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."roles" WHERE lower(name) = lower(%s) AND id <> %s',
        (name, role_id),
    )
    if cur.fetchone():
        return fail("customTypes.error.roleNameTaken")
    cur.execute(
        'UPDATE "MiniPLM"."roles" SET name = %s, updated_at = now() WHERE id = %s',
        (name, role_id),
    )
    
    return {"ok": True, "roleId": role_id, "name": name}


def do_delete_role(ctx, cur, data):
    raw_id = data.get("id")
    try:
        role_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")
    cur.execute('SELECT name FROM "MiniPLM"."roles" WHERE id = %s', (role_id,))
    row = cur.fetchone()
    if not row:
        return fail("customTypes.error.notFound")
    role_name = row[0]
    # Check if role is used in any workflow type transitions
    cur.execute(
        'SELECT id, name FROM "MiniPLM"."custom_types" WHERE category = %s',
        ("workflow",),
    )
    for wf_id, wf_name in cur.fetchall():
        cur.execute('SELECT transitions FROM "MiniPLM"."custom_types" WHERE id = %s', (wf_id,))
        trans_row = cur.fetchone()
        transitions = trans_row[0] if isinstance(trans_row[0], list) else []
        for tr in transitions:
            if isinstance(tr, dict) and tr.get("role") == role_name:
                return fail("customTypes.error.roleInUse", field=f"workflow:{wf_name}")
    cur.execute('DELETE FROM "MiniPLM"."roles" WHERE id = %s', (role_id,))
    
    return {"ok": True, "deleted": role_id, "name": role_name}


def do_set_role_members(ctx, cur, data):
    raw_id = data.get("id")
    try:
        role_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")
    cur.execute('SELECT name FROM "MiniPLM"."roles" WHERE id = %s', (role_id,))
    if not cur.fetchone():
        return fail("customTypes.error.notFound")
    members = data.get("members", [])
    if not isinstance(members, list):
        return fail("customTypes.error.members")
    # Clear existing members
    cur.execute('DELETE FROM "MiniPLM"."user_roles" WHERE role_id = %s', (role_id,))
    # Add new members
    for user_id in members:
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            return fail("customTypes.error.members")
        cur.execute(
            'SELECT 1 FROM "MiniPLM"."users" WHERE id = %s',
            (uid,),
        )
        if not cur.fetchone():
            return fail("customTypes.error.userNotFound", userId=uid)
        cur.execute(
            'INSERT INTO "MiniPLM"."user_roles" (user_id, role_id) VALUES (%s, %s)',
            (uid, role_id),
        )
    
    return {"ok": True, "roleId": role_id, "memberCount": len(members)}


# Role list operations
def do_create_role_list(ctx, cur, data):
    name = str(data.get("name") or "").strip()
    if not name or len(name) > 100:
        return fail("customTypes.error.roleListName")
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."role_lists" WHERE lower(name) = lower(%s)',
        (name,),
    )
    if cur.fetchone():
        return fail("customTypes.error.roleListNameTaken")
    cur.execute(
        'INSERT INTO "MiniPLM"."role_lists" (name) VALUES (%s)',
        (name,),
    )
    cur.execute('SELECT id FROM "MiniPLM"."role_lists" WHERE lower(name) = lower(%s)', (name,))
    list_id = cur.fetchone()[0]
    
    return {"ok": True, "roleListId": list_id, "name": name}


def do_update_role_list(ctx, cur, data):
    raw_id = data.get("id")
    try:
        list_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")
    cur.execute('SELECT id, name FROM "MiniPLM"."role_lists" WHERE id = %s', (list_id,))
    row = cur.fetchone()
    if not row:
        return fail("customTypes.error.notFound")
    _, current_name = row
    name = str(data.get("name") or "").strip() or current_name
    if not name or len(name) > 100:
        return fail("customTypes.error.roleListName")
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."role_lists" WHERE lower(name) = lower(%s) AND id <> %s',
        (name, list_id),
    )
    if cur.fetchone():
        return fail("customTypes.error.roleListNameTaken")
    cur.execute(
        'UPDATE "MiniPLM"."role_lists" SET name = %s, updated_at = now() WHERE id = %s',
        (name, list_id),
    )
    
    return {"ok": True, "roleListId": list_id, "name": name}


def do_delete_role_list(ctx, cur, data):
    raw_id = data.get("id")
    try:
        list_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")
    cur.execute('SELECT name FROM "MiniPLM"."role_lists" WHERE id = %s', (list_id,))
    row = cur.fetchone()
    if not row:
        return fail("customTypes.error.notFound")
    list_name = row[0]
    # Check if role list is used by any workflow type
    cur.execute(
        'SELECT id, name FROM "MiniPLM"."custom_types" WHERE role_list_id = %s',
        (list_id,),
    )
    for wf_id, wf_name in cur.fetchall():
        return fail("customTypes.error.roleListInUse", field=f"workflow:{wf_name}")
    cur.execute('DELETE FROM "MiniPLM"."role_lists" WHERE id = %s', (list_id,))
    
    return {"ok": True, "deleted": list_id, "name": list_name}


def do_set_role_list_members(ctx, cur, data):
    raw_id = data.get("id")
    try:
        list_id = int(raw_id)
    except (TypeError, ValueError):
        return fail("customTypes.error.notFound")
    cur.execute('SELECT name FROM "MiniPLM"."role_lists" WHERE id = %s', (list_id,))
    if not cur.fetchone():
        return fail("customTypes.error.notFound")
    members = data.get("members", [])
    if not isinstance(members, list) or len(members) > MAX_ROLE_LIST_SIZE:
        return fail("customTypes.error.roleListMembers")
    # Clear existing members
    cur.execute('DELETE FROM "MiniPLM"."role_list_members" WHERE role_list_id = %s', (list_id,))
    # Add new members
    for role_id in members:
        try:
            rid = int(role_id)
        except (TypeError, ValueError):
            return fail("customTypes.error.roleListMembers")
        cur.execute('SELECT 1 FROM "MiniPLM"."roles" WHERE id = %s', (rid,))
        if not cur.fetchone():
            return fail("customTypes.error.roleNotFound", roleId=rid)
        cur.execute(
            'INSERT INTO "MiniPLM"."role_list_members" (role_list_id, role_id) VALUES (%s, %s)',
            (list_id, rid),
        )
    
    return {"ok": True, "roleListId": list_id, "memberCount": len(members)}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Custom types not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    try:
        session, error = require_session(ctx, args)
        if error is not None:
            return error

        if method == "GET":
            # Read-only: every authenticated user needs the custom type
            # definitions to fill custom fields and progress values.
            return do_list(ctx, session)

        with conn.cursor() as cur:
            if not user_is_sysadmin(cur, session.get("userId")):
                return fail("forbidden")

        operation = str(data.get("operation") or "").strip().lower()
        if operation in ("list", "list-custom-types"):
            return do_list(ctx, session)
        if operation in ("create", "create-custom-type"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_create(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("update", "update-custom-type"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_update(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("delete", "delete-custom-type"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_delete(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("set-progress-type", "setprogress"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = set_progress_type(ctx, data)
            conn.commit()
            return result
        # Role operations
        if operation in ("create-role", "createrole"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_create_role(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("update-role", "updaterole"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_update_role(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("delete-role", "deleterole"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_delete_role(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("set-role-members", "setrolemembers"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_set_role_members(ctx, cur, data)
            conn.commit()
            return result
        # Role list operations
        if operation in ("create-role-list", "createrolelist"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_create_role_list(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("update-role-list", "updaterolelist"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_update_role_list(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("delete-role-list", "deleterolelist"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_delete_role_list(ctx, cur, data)
            conn.commit()
            return result
        if operation in ("set-role-list-members", "setrolelistmembers"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_set_role_list_members(ctx, cur, data)
            conn.commit()
            return result
        return fail("customTypes.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("customTypes.error.request", detail=str(exc))
