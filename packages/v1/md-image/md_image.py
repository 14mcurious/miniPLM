"""MiniPLM markdown images (private, app-local image store).

Images inserted from the user's disk into "md" fields are stored permanently
in the private, bucket-scoped S3 data bucket under the "md-images/" prefix.
No external or public image hosting is used: the object lives in the user's
own platform storage and is served back only to authenticated sessions.

The markdown source keeps a stable reference:
    ![alt](/api/my/v1/md-image?img=<id>)
The browser resolves the reference through this endpoint (session
authenticated) and renders the bytes; updating an image overwrites the
object under the same id (references keep working) and deleting removes the
object and the metadata row.

Metadata lives in the "MiniPLM"."md_images" table (created idempotently by
setup/database).
"""

import base64
import binascii
import json
import re
import time
import uuid

KEY_PREFIX = "md-images/"
REF_PREFIX = "/api/my/v1/md-image?img="
ID_RE = re.compile(r"^[a-f0-9]{32}$")
# The web-action gateway rejects request bodies over 1 MiB (413). Base64
# inflates ~33%, so 700 KiB of raw image bytes stay safely under the limit
# (~933 KiB of base64 + JSON envelope). Larger files are rejected here with
# a clean error instead of a gateway 413.
MAX_SIZE = 700 * 1024  # 700 KB raw (base64 body through the web action)

# Content type -> allowed file extensions (kept in sync with the frontend
# picker and the DOCX export image support).
ALLOWED_IMAGE_TYPES = {
    "image/png": {".png"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/gif": {".gif"},
    "image/webp": {".webp"},
}


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
    ignored = {
        "body", "POSTGRES_URL", "__ow_method", "__ow_headers", "__ow_path",
    }
    merged.update({k: v for k, v in data.items() if k not in ignored})
    return merged


def request_method(args):
    return (args.get("__ow_method") or args.get("method") or "GET").upper()


def fail(key, **params):
    result = {"ok": False, "error": key}
    if params:
        result["errorParams"] = params
    return result


def safe_file_name(raw_name):
    name = str(raw_name or "").strip()
    name = name.replace("/", "_").replace("\\", "_")
    name = re.sub(r"\s+", " ", name)[-120:]
    return name or "image"


def normalize_image_ref(value):
    """Accept an image id or a full reference URL and return the raw id."""
    ref = str(value or "").strip()
    if ref.startswith(REF_PREFIX):
        ref = ref[len(REF_PREFIX):].split("?", 1)[0]
    return ref.strip()


def extension_for(content_type, file_name):
    """Extension consistent with the declared content type, if any."""
    allowed = ALLOWED_IMAGE_TYPES.get(content_type)
    if not allowed:
        return None
    base = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if base and f".{base}" in allowed:
        return f".{base}"
    return sorted(allowed)[0]


def parse_image_upload(data):
    """Validate base64 image payload; returns (bytes, content_type, ext, error)."""
    content_b64 = str(data.get("content") or "").strip()
    if not content_b64:
        return None, None, None, fail("mdImage.error.contentRequired")
    try:
        payload = base64.b64decode(content_b64, validate=True)
    except (binascii.Error, ValueError):
        return None, None, None, fail("mdImage.error.contentInvalid")
    if not payload:
        return None, None, None, fail("mdImage.error.contentRequired")
    if len(payload) > MAX_SIZE:
        return None, None, None, fail("mdImage.error.tooLarge", max="700 KB")

    file_name = safe_file_name(data.get("fileName", data.get("file_name")))
    content_type = str(
        data.get("contentType", data.get("content_type")) or ""
    ).strip().lower()
    ext = extension_for(content_type, file_name)
    if ext is None:
        return None, None, None, fail("mdImage.error.unsupportedType")
    return payload, content_type, ext, None


def fetch_image(cur, image_id):
    cur.execute(
        'SELECT id, s3_key, file_name, content_type, size_bytes,'
        " to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS'),"
        " to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS')"
        ' FROM "MiniPLM"."md_images" WHERE id = %s',
        (image_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "s3Key": row[1],
        "fileName": row[2],
        "contentType": row[3],
        "size": int(row[4]),
        "createdAt": row[5],
        "updatedAt": row[6],
    }


def image_payload(row):
    return {
        "id": row["id"],
        "ref": f"{REF_PREFIX}{row['id']}",
        "fileName": row["fileName"],
        "size": row["size"],
        "contentType": row["contentType"],
        "createdAt": row["createdAt"],
        "updatedAt": row["updatedAt"],
    }


def do_get(ctx, cur, image_id):
    row = fetch_image(cur, image_id)
    if row is None:
        return fail("mdImage.error.notFound")
    try:
        response = ctx.S3_CLIENT.get_object(
            Bucket=ctx.S3_DATA, Key=row["s3Key"]
        )
        payload = response["Body"].read()
    except Exception:
        return fail("mdImage.error.notFound")
    return {
        "ok": True,
        "image": {
            **image_payload(row),
            "content": base64.b64encode(payload).decode("ascii"),
        },
    }


def do_list(ctx, cur):
    cur.execute(
        'SELECT id, s3_key, file_name, content_type, size_bytes,'
        " to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS'),"
        " to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS')"
        ' FROM "MiniPLM"."md_images" ORDER BY updated_at DESC, id'
    )
    rows = []
    for row in cur.fetchall():
        rows.append(
            {
                "id": row[0],
                "s3Key": row[1],
                "fileName": row[2],
                "contentType": row[3],
                "size": int(row[4]),
                "createdAt": row[5],
                "updatedAt": row[6],
            }
        )
    return {"ok": True, "images": [image_payload(r) for r in rows]}


def do_upload(ctx, cur, data, user_id):
    payload, content_type, ext, error = parse_image_upload(data)
    if error is not None:
        return error
    file_name = safe_file_name(data.get("fileName", data.get("file_name")))
    image_id = uuid.uuid4().hex
    s3_key = f"{KEY_PREFIX}{image_id}{ext}"
    try:
        ctx.S3_CLIENT.put_object(
            Bucket=ctx.S3_DATA,
            Key=s3_key,
            Body=payload,
            ContentType=content_type,
        )
    except Exception as exc:
        return fail("mdImage.error.upload", detail=str(exc))

    try:
        cur.execute(
            'INSERT INTO "MiniPLM"."md_images"'
            " (id, s3_key, file_name, content_type, size_bytes, created_by,"
            "  created_at, updated_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, now(), now())",
            (
                image_id,
                s3_key,
                file_name,
                content_type,
                len(payload),
                user_id,
            ),
        )
    except Exception:
        # Roll back the S3 object: the image must not exist without metadata.
        try:
            ctx.S3_CLIENT.delete_object(Bucket=ctx.S3_DATA, Key=s3_key)
        except Exception:
            pass
        return fail("mdImage.error.upload")

    row = fetch_image(cur, image_id)
    if row is None:
        return fail("mdImage.error.notFound")
    return {"ok": True, "image": image_payload(row)}


def do_replace(ctx, cur, data, user_id):
    image_id = normalize_image_ref(
        data.get("id", data.get("img", data.get("imageId")))
    )
    if not ID_RE.match(image_id):
        return fail("mdImage.error.notFound")
    existing = fetch_image(cur, image_id)
    if existing is None:
        return fail("mdImage.error.notFound")

    payload, content_type, ext, error = parse_image_upload(data)
    if error is not None:
        return error
    file_name = safe_file_name(data.get("fileName", data.get("file_name")))
    if not file_name or file_name == "image":
        file_name = existing["fileName"]

    # Keep the original object key so every existing markdown reference
    # continues to resolve; only the bytes and metadata change.
    s3_key = existing["s3Key"]
    try:
        ctx.S3_CLIENT.put_object(
            Bucket=ctx.S3_DATA,
            Key=s3_key,
            Body=payload,
            ContentType=content_type,
        )
    except Exception as exc:
        return fail("mdImage.error.replace", detail=str(exc))

    try:
        cur.execute(
            'UPDATE "MiniPLM"."md_images"'
            " SET file_name = %s, content_type = %s, size_bytes = %s,"
            "     updated_at = now()"
            " WHERE id = %s",
            (file_name, content_type, len(payload), image_id),
        )
    except Exception:
        return fail("mdImage.error.replace")

    row = fetch_image(cur, image_id)
    if row is None:
        return fail("mdImage.error.notFound")
    return {"ok": True, "image": image_payload(row)}


def do_delete(ctx, cur, data):
    image_id = normalize_image_ref(
        data.get("id", data.get("img", data.get("imageId")))
    )
    if not ID_RE.match(image_id):
        return fail("mdImage.error.notFound")
    row = fetch_image(cur, image_id)
    if row is None:
        # Already gone: deleting again is a safe no-op.
        return {"ok": True, "deleted": True}
    try:
        cur.execute(
            'DELETE FROM "MiniPLM"."md_images" WHERE id = %s', (image_id,)
        )
    except Exception:
        return fail("mdImage.error.delete")
    try:
        ctx.S3_CLIENT.delete_object(Bucket=ctx.S3_DATA, Key=row["s3Key"])
    except Exception:
        pass
    return {"ok": True, "deleted": True}


def main(args, ctx=None):
    if (
        not ctx
        or not hasattr(ctx, "S3_CLIENT")
        or not hasattr(ctx, "REDIS")
        or not hasattr(ctx, "POSTGRESQL")
    ):
        return {"ok": False, "error": "Markdown images not configured"}

    method = request_method(args)
    data = request_data(args)
    conn = ctx.POSTGRESQL

    try:
        session, error = require_session(ctx, args)
        if error is not None:
            return error
        user_id = session.get("userId")
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            user_id = None

        if method == "GET":
            image_id = normalize_image_ref(
                data.get("id", data.get("img", data.get("imageId")))
            )
            if not ID_RE.match(image_id):
                return fail("mdImage.error.notFound")
            with conn.cursor() as cur:
                return do_get(ctx, cur, image_id)

        operation = str(data.get("operation") or "").strip().lower()
        if operation in ("get", "get-image"):
            image_id = normalize_image_ref(
                data.get("id", data.get("img", data.get("imageId")))
            )
            if not ID_RE.match(image_id):
                return fail("mdImage.error.notFound")
            with conn.cursor() as cur:
                return do_get(ctx, cur, image_id)
        if operation in ("list", "list-images"):
            with conn.cursor() as cur:
                return do_list(ctx, cur)
        if operation in ("upload", "create", "upload-image"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_upload(ctx, cur, data, user_id)
            conn.commit()
            return result
        if operation in ("replace", "update", "replace-image"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_replace(ctx, cur, data, user_id)
            conn.commit()
            return result
        if operation in ("delete", "delete-image"):
            if not require_csrf(ctx, args, session):
                return fail("csrf")
            with conn.cursor() as cur:
                result = do_delete(ctx, cur, data)
            conn.commit()
            return result
        return fail("mdImage.error.request")
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return fail("mdImage.error.request", detail=str(exc))
