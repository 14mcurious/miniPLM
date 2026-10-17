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
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


def validate_transitions(option_values, raw_transitions):
    """Normalize and validate the workflow state transitions.

    Transitions are {from, to} pairs referencing existing option values.
    Duplicates are dropped; invalid references are rejected.
    """
    if raw_transitions is None:
        raw_transitions = []
    if not isinstance(raw_transitions, list):
        return None, fail("customTypes.error.transitions")
    valid = set(option_values)
    transitions = []
    seen = set()
    for item in raw_transitions:
        if not isinstance(item, dict):
            return None, fail("customTypes.error.transitions")
        src = str(item.get("from") or "").strip()
        dst = str(item.get("to") or "").strip()
        if not src or not dst:
            return None, fail("customTypes.error.transitionValue")
        if src not in valid or dst not in valid:
            return None, fail("customTypes.error.transitionValue")
        key = (src, dst)
        if key in seen:
            continue
        seen.add(key)
        transitions.append({"from": src, "to": dst})
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
            'SELECT id, name, value_type, multi_select, category, options,'
            ' is_disabled, created_at, updated_at, initial_state, transitions'
            ' FROM "MiniPLM"."custom_types"'
            " ORDER BY category, name COLLATE \"C\""
        )
        rows = cur.fetchall()
        cur.execute(
            'SELECT value FROM "MiniPLM"."settings"'
            " WHERE key = 'workflow_progress_type'"
        )
        setting = cur.fetchone()
        progress_type_name = (setting[0] if setting else "").strip()
    return {
        "ok": True,
        "customTypes": [custom_type_to_dict(r) for r in rows],
        "workflowProgressType": progress_type_name or None,
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
        transitions, error = validate_transitions(
            option_values, data.get("transitions")
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
            "  initial_state, transitions)"
            " VALUES (%s, %s, %s, %s, %s, FALSE, %s, %s)",
            (
                name,
                value_type,
                multi_select,
                category,
                json.dumps(options),
                initial_state,
                json.dumps(transitions),
            ),
        )
        cur.execute(
            'SELECT currval(%s::regclass)', ('"MiniPLM".custom_types_id_seq',)
        )
        type_id = cur.fetchone()[0]
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT id, name, value_type, multi_select, category, options,'
            ' is_disabled, created_at, updated_at, initial_state, transitions'
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
    ctx.POSTGRESQL.commit()
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
            ' initial_state, transitions'
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
        if "transitions" in data:
            transitions, error = validate_transitions(
                option_values, data.get("transitions")
            )
            if error is not None:
                return error
        else:
            raw_current = (
                current_transitions
                if isinstance(current_transitions, list)
                else []
            )
            transitions = [
                {"from": t["from"], "to": t["to"]}
                for t in raw_current
                if isinstance(t, dict)
                and t.get("from") in option_values
                and t.get("to") in option_values
            ]

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
            "     initial_state = %s, transitions = %s,"
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
                type_id,
            ),
        )
    ctx.POSTGRESQL.commit()

    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'SELECT id, name, value_type, multi_select, category, options,'
            ' is_disabled, created_at, updated_at, initial_state, transitions'
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
    ctx.POSTGRESQL.commit()
    return {"ok": True, "deleted": type_id}


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
            return do_create(ctx, session, data)
        if operation in ("update", "update-custom-type"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_update(ctx, session, data)
        if operation in ("delete", "delete-custom-type"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_delete(ctx, session, data)
        if operation in ("set-progress-type", "setprogress"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return set_progress_type(ctx, data)
        return fail("customTypes.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("customTypes.error.request", detail=str(exc))
