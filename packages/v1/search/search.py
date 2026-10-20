"""MiniPLM work area search.

Searches the elements of the accessible work areas (projects) with a
Lucene/Solr-like query language. Results are grouped by category (work
container, work instance) and presented as tables; the columns of each
table are configured by the administrator in the Configuration area
(setting search_columns). The default columns are: id, title, progress,
updated. Work spaces are not part of the search.

Supported query syntax (subset of Lucene):
  word                 full-text match over name/title/description/etc.
  "quoted phrase"      exact phrase match
  field:value          restrict the match to one field
  field:"quoted value" exact phrase on one field
  field:*              field is present
  AND  OR  NOT         boolean operators (AND binds tighter than OR)
  ( ... )              grouping; adjacent terms imply AND

Queryable fields:
  container:   name, title, description, progress, author, category
  instance:    name, progress, assignees, template, author, category
               plus every template field name (e.g. weight:10, status:done)
"""

import json
import re
import time

QUERYABLE = {
    "workcontainer": (
        "name",
        "title",
        "description",
        "progress",
        "author",
        "category",
    ),
    "workinstance": (
        "name",
        "progress",
        "assignees",
        "template",
        "author",
        "category",
    ),
}
# Columns an administrator may enable in the results tables, per
# category. id, name and title are full columns like the others; the
# default set is id, title, progress, updated.
ALLOWED_COLUMNS = {
    "workcontainer": (
        "id",
        "name",
        "title",
        "description",
        "progress",
        "author",
        "updated",
    ),
    "workinstance": (
        "id",
        "name",
        "title",
        "progress",
        "assignees",
        "template",
        "author",
        "updated",
    ),
}
DEFAULT_COLUMNS = {
    "workcontainer": ["id", "title", "progress", "updated"],
    "workinstance": ["id", "title", "progress", "updated"],
}
MAX_RESULTS_PER_CATEGORY = 200


class QueryError(Exception):
    """Raised when the query string is not parseable."""


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


# --- Query tokenizer -------------------------------------------------------


def tokenize(query):
    """Tokenize into a list of tuples.

    LPAREN  (            RPAREN  )
    AND / OR / NOT       boolean operators (exact uppercase words)
    TERM   (field,value) field may be None for full-text; value "*" is a
                         wildcard; phrase flag is the 4th element.
    """
    tokens = []
    i, n = 0, len(query)
    while i < n:
        c = query[i]
        if c.isspace():
            i += 1
            continue
        if c == "(":
            tokens.append(("LPAREN",))
            i += 1
            continue
        if c == ")":
            tokens.append(("RPAREN",))
            i += 1
            continue
        if c == '"':
            j = query.find('"', i + 1)
            if j == -1:
                raise QueryError("unterminated quote")
            phrase = query[i + 1 : j]
            if not phrase:
                raise QueryError("empty quoted phrase")
            tokens.append(("QUOTED", phrase))
            i = j + 1
            continue
        j = i
        while j < n and not query[j].isspace() and query[j] not in '()"':
            j += 1
        word = query[i:j]
        if not word:
            raise QueryError("empty term")
        if word.endswith(":") and j < n and query[j] == '"':
            field = word[:-1]
            if not field:
                raise QueryError("empty field name")
            k = query.find('"', j + 1)
            if k == -1:
                raise QueryError("unterminated quote")
            value = query[j + 1 : k]
            if not value:
                raise QueryError("empty quoted phrase")
            tokens.append(("TERM", field, value, True))
            i = k + 1
            continue
        if ":" in word:
            field, _, value = word.partition(":")
            if not field or not value:
                raise QueryError("invalid field query")
            tokens.append(("TERM", field, value, False))
        elif word in ("AND", "OR", "NOT"):
            tokens.append((word,))
        else:
            tokens.append(("TERM", None, word, False))
        i = j
    return tokens


# --- Query parser (recursive descent) --------------------------------------
# Precedence (low to high): OR < AND < NOT < primary.


def parse_query(query):
    tokens = tokenize(query)
    pos = 0

    def peek():
        return tokens[pos] if pos < len(tokens) else None

    def advance():
        nonlocal pos
        token = tokens[pos]
        pos += 1
        return token

    def parse_or():
        node = parse_and()
        while True:
            token = peek()
            if token is not None and token[0] == "OR":
                advance()
                node = ("or", [node, parse_and()])
            else:
                return node

    def parse_and():
        node = parse_not()
        while True:
            token = peek()
            if token is None:
                return node
            if token[0] == "AND":
                advance()
                node = ("and", [node, parse_not()])
            elif token[0] in ("TERM", "LPAREN", "NOT"):
                node = ("and", [node, parse_not()])
            else:
                return node

    def parse_not():
        token = peek()
        if token is not None and token[0] == "NOT":
            advance()
            return ("not", parse_not())
        return parse_primary()

    def parse_primary():
        token = peek()
        if token is None:
            return ("true",)
        if token[0] == "LPAREN":
            advance()
            node = parse_or()
            closing = peek()
            if closing is None or closing[0] != "RPAREN":
                raise QueryError("missing closing parenthesis")
            advance()
            return node
        if token[0] == "QUOTED":
            advance()
            return ("term", None, token[1], True)
        if token[0] == "TERM":
            advance()
            return ("term", token[1], token[2], token[3])
        raise QueryError("unexpected token")

    node = parse_or()
    if pos != len(tokens):
        raise QueryError("unexpected trailing tokens")
    return node


# --- Query evaluation ------------------------------------------------------


def _tokens_of(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        result = []
        for item in value:
            result.extend(_tokens_of(item))
        return result
    if isinstance(value, (int, float)):
        value = str(value)
    return re.findall(r"[a-z0-9]+", str(value).lower())


def _text_of(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " ".join(_text_of(item) for item in value)
    if isinstance(value, (int, float)):
        return str(value)
    return str(value)


def eval_node(node, doc):
    kind = node[0]
    if kind == "true":
        return True
    if kind == "and":
        return all(eval_node(child, doc) for child in node[1])
    if kind == "or":
        return any(eval_node(child, doc) for child in node[1])
    if kind == "not":
        return not eval_node(node[1], doc)
    # term
    _, field, value, phrase = node
    if value == "*":
        return True if field is None else field in doc
    if field is not None:
        if field not in doc:
            return False
        text = _text_of(doc[field]).lower()
        if phrase:
            return value.lower() in text
        wanted = _tokens_of(value)
        present = set(_tokens_of(text))
        return all(token in present for token in wanted)
    for value_part in doc.values():
        text = _text_of(value_part).lower()
        if phrase:
            if value.lower() in text:
                return True
        else:
            present = set(_tokens_of(text))
            wanted = _tokens_of(value)
            if wanted and all(token in present for token in wanted):
                return True
    return False


def accessible_project_ids(cur, user_id):
    cur.execute(
        'SELECT DISTINCT p.id FROM "MiniPLM"."projects" p'
        ' JOIN "MiniPLM"."group_projects" gp ON gp.project_name = p.name'
        ' JOIN "MiniPLM"."user_groups" ug ON ug.group_id = gp.group_id'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.is_disabled = FALSE",
        (user_id,),
    )
    return [row[0] for row in cur.fetchall()]


def user_display(cur, user_id):
    if user_id is None:
        return ""
    cur.execute(
        'SELECT login_name || \' (\' || name || \' \' || surname || \')\' FROM "MiniPLM"."users" WHERE id = %s',
        (user_id,),
    )
    row = cur.fetchone()
    return row[0] if row else ""


def build_documents(cur, project_ids):
    """Flatten the accessible elements into searchable documents.

    Work spaces are intentionally excluded: the search tables present
    work containers and work instances only.
    """
    placeholders = ",".join(["%s"] * len(project_ids))
    docs = []

    cur.execute(
        'SELECT c.id, c.identifier, c.name, c.title, c.description, c.progress,'
        ' c.author_id, c.updated_at'
        ' FROM "MiniPLM"."work_containers" c'
        f' WHERE c.project_id IN ({placeholders})',
        tuple(project_ids),
    )
    for (
        container_id, identifier, name, title, description,
        progress, author_id, updated_at,
    ) in cur.fetchall():
        docs.append(
            {
                "category": "workcontainer",
                "id": identifier,
                "dbId": str(container_id),
                "name": name or "",
                "title": title or "",
                "description": description or "",
                "progress": progress or "",
                "author": user_display(cur, author_id),
                "updated": updated_at.isoformat() if updated_at else "",
            }
        )

    cur.execute(
        'SELECT i.id, i.instance_id, i.name, i.progress, i.assignees,'
        ' i.author_id, i.updated_at, t.name, i.fields'
        ' FROM "MiniPLM"."work_instances" i'
        ' LEFT JOIN "MiniPLM"."work_instance_templates" t ON t.id = i.template_id'
        f' WHERE i.project_id IN ({placeholders})',
        tuple(project_ids),
    )
    for (
        instance_db_id, instance_id, name, progress, assignees,
        author_id, updated_at, template_name, fields,
    ) in cur.fetchall():
        assignee_ids = assignees if isinstance(assignees, list) else []
        if assignee_ids:
            assignee_ph = ",".join(["%s"] * len(assignee_ids))
            cur.execute(
                f"SELECT login_name FROM \"MiniPLM\".\"users\""
                f" WHERE id IN ({assignee_ph})",
                tuple(assignee_ids),
            )
            assignee_names = [row[0] for row in cur.fetchall()]
        else:
            assignee_names = []
        doc = {
            "category": "workinstance",
            "id": instance_id,
            "dbId": str(instance_db_id),
            "name": name or "",
            "progress": progress or "",
            "assignees": assignee_names,
            "template": template_name or "",
            "author": user_display(cur, author_id),
            "updated": updated_at.isoformat() if updated_at else "",
        }
        for field in fields if isinstance(fields, list) else []:
            if not isinstance(field, dict):
                continue
            field_name = str(field.get("name") or "").strip()
            if not field_name:
                continue
            value = field.get("value")
            if isinstance(value, dict) and value.get("fileName"):
                value = value.get("fileName")
            doc[field_name] = value
        docs.append(doc)
    return docs


def load_columns(cur):
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        ("search_columns",),
    )
    row = cur.fetchone()
    raw = row[0] if row else None
    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    columns = {}
    for category in ("workcontainer", "workinstance"):
        values = parsed.get(category)
        if not isinstance(values, list):
            values = DEFAULT_COLUMNS[category]
        columns[category] = [
            str(v) for v in values if str(v) in ALLOWED_COLUMNS[category]
        ]
    return columns


def do_search(ctx, session, data):
    query = str(data.get("query") or "").strip()
    raw_project = data.get("projectId", data.get("project_id"))
    project_scope = None
    if raw_project not in (None, ""):
        try:
            project_scope = int(raw_project)
        except (TypeError, ValueError):
            return fail("search.error.invalidQuery")

    try:
        tree = parse_query(query)
    except QueryError as exc:
        return fail("search.error.invalidQuery", detail=str(exc))

    with ctx.POSTGRESQL.cursor() as cur:
        project_ids = accessible_project_ids(cur, session.get("userId"))
        if not project_ids:
            return {"ok": True, "total": 0, "groups": [], "columns": load_columns(cur)}
        if project_scope is not None:
            if project_scope not in project_ids:
                return fail("forbidden")
            project_ids = [project_scope]
        documents = build_documents(cur, project_ids)
        columns = load_columns(cur)

    matched = [doc for doc in documents if eval_node(tree, doc)]
    groups = []
    for category in ("workcontainer", "workinstance"):
        rows = [doc for doc in matched if doc["category"] == category]
        rows.sort(key=lambda doc: (doc["name"].lower(), doc["id"]))
        groups.append(
            {
                "category": category,
                "count": len(rows),
                "rows": [
                    {
                        "id": doc["id"],
                        "dbId": doc.get("dbId", doc["id"]),
                        "name": doc["name"],
                        "title": doc.get("title", ""),
                        "cells": {
                            key: doc.get(key, "")
                            for key in columns[category]
                        },
                    }
                    for doc in rows[:MAX_RESULTS_PER_CATEGORY]
                ],
            }
        )
    return {
        "ok": True,
        "query": query,
        "total": len(matched),
        "columns": columns,
        "groups": groups,
    }


def user_is_sysadmin(cur, user_id):
    cur.execute(
        'SELECT 1 FROM "MiniPLM"."user_groups" ug'
        ' JOIN "MiniPLM"."groups" g ON g.id = ug.group_id'
        " WHERE ug.user_id = %s AND g.name = %s AND g.is_disabled = FALSE",
        (user_id, "SysAdmin"),
    )
    return cur.fetchone() is not None


def require_csrf(ctx, args, session):
    expected = str(session.get("csrf") or "")
    sent = str(request_headers(args).get("x-csrf-token") or "").strip()
    if not expected or sent != expected:
        return False
    return True


def do_get_columns(ctx, session):
    with ctx.POSTGRESQL.cursor() as cur:
        columns = load_columns(cur)
    return {"ok": True, "columns": columns, "allowed": ALLOWED_COLUMNS}


def do_update_columns(ctx, session, data):
    raw = data.get("columns")
    if not isinstance(raw, dict):
        return fail("search.error.invalidColumns")
    columns = {}
    for category in ("workcontainer", "workinstance"):
        values = raw.get(category)
        if values is None:
            values = []
        if not isinstance(values, list):
            return fail("search.error.invalidColumns")
        columns[category] = [
            str(v) for v in values if str(v) in ALLOWED_COLUMNS[category]
        ]
    with ctx.POSTGRESQL.cursor() as cur:
        cur.execute(
            'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)'
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            ("search_columns", json.dumps(columns)),
        )
    ctx.POSTGRESQL.commit()
    return {"ok": True, "columns": columns}


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Search not configured"}

    method = request_method(args)
    data = request_data(args)

    try:
        session, error = require_session(ctx, args)
        if error is not None:
            return error
        if method == "GET" or not data.get("operation"):
            return do_search(ctx, session, data)
        operation = str(data.get("operation") or "").strip().lower()
        if operation in ("search", "run-search", "query"):
            return do_search(ctx, session, data)
        if operation in ("get-columns", "getcolumns"):
            return do_get_columns(ctx, session)
        if operation in ("update-columns", "updatecolumns"):
            with ctx.POSTGRESQL.cursor() as cur:
                if not user_is_sysadmin(cur, session.get("userId")):
                    return fail("forbidden")
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            return do_update_columns(ctx, session, data)
        return fail("search.error.request")
    except Exception as exc:
        try:
            ctx.POSTGRESQL.rollback()
        except Exception:
            pass
        return fail("search.error.request", detail=str(exc))
