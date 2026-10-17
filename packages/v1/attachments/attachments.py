"""MiniPLM attachments (S3-backed).

Uploads and downloads files attached to work instance fields of type
"attachment". Objects are stored in the bucket-scoped S3 data bucket
under the "work-instances/" prefix; the value kept on the work instance
field is a reference object: {s3Key, fileName, size, contentType}.

Requires a valid Redis session. Keys outside the work-instances/ prefix
are rejected on download.
"""

import base64
import json
import re
import time
import uuid

KEY_PREFIX = "work-instances/"
KEY_RE = re.compile(r"^work-instances/[A-Za-z0-9._/-]+$")
MAX_SIZE = 5 * 1024 * 1024  # 5 MB (base64 body through the web action)
ALLOWED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".csv", ".json", ".xml", ".html", ".htm",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".zip", ".doc", ".docx",
    ".xls", ".xlsx", ".ppt", ".pptx", ".log", ".yaml", ".yml", ".sql",
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


def safe_file_name(raw_name):
    name = str(raw_name or "").strip()
    name = name.replace("/", "_").replace("\\", "_")
    name = re.sub(r"\s+", " ", name)[-120:]
    return name or "file"


def do_upload(ctx, args, data):
    file_name = safe_file_name(data.get("fileName", data.get("file_name")))
    content_b64 = str(data.get("content") or "").strip()
    content_type = str(data.get("contentType", data.get("content_type")) or "").strip()
    if not content_b64:
        return fail("attachments.error.contentRequired")
    try:
        payload = base64.b64decode(content_b64, validate=True)
    except Exception:
        return fail("attachments.error.contentInvalid")
    if not payload:
        return fail("attachments.error.contentRequired")
    if len(payload) > MAX_SIZE:
        return fail("attachments.error.tooLarge", max=MAX_SIZE)
    extension = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if extension and extension not in ALLOWED_EXTENSIONS:
        return fail("attachments.error.unsupportedType")

    s3_key = f"{KEY_PREFIX}{uuid.uuid4().hex}/{file_name}"
    if not content_type:
        content_type = "application/octet-stream"
    try:
        ctx.S3_CLIENT.put_object(
            Bucket=ctx.S3_DATA,
            Key=s3_key,
            Body=payload,
            ContentType=content_type,
        )
    except Exception as exc:
        return fail("attachments.error.upload", detail=str(exc))

    return {
        "ok": True,
        "attachment": {
            "s3Key": s3_key,
            "fileName": file_name,
            "size": len(payload),
            "contentType": content_type,
        },
    }


def do_download(ctx, args, data):
    s3_key = str(data.get("s3Key", data.get("s3_key")) or "").strip()
    if not KEY_RE.match(s3_key):
        return fail("attachments.error.notFound")
    try:
        response = ctx.S3_CLIENT.get_object(Bucket=ctx.S3_DATA, Key=s3_key)
        payload = response["Body"].read()
        metadata = response.get("Metadata", {}) or {}
    except Exception:
        return fail("attachments.error.notFound")
    meta_name = str(metadata.get("fileName") or s3_key.rsplit("/", 1)[-1])
    content_type = str(
        response.get("ContentType") or metadata.get("contentType")
        or "application/octet-stream"
    )
    return {
        "ok": True,
        "attachment": {
            "s3Key": s3_key,
            "fileName": meta_name,
            "size": len(payload),
            "contentType": content_type,
            "content": base64.b64encode(payload).decode("ascii"),
        },
    }


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "S3_CLIENT") or not hasattr(ctx, "REDIS"):
        return {"ok": False, "error": "Attachments not configured"}

    method = request_method(args)
    data = request_data(args)

    try:
        session, error = require_session(ctx, args)
        if error is not None:
            return error
        if method == "GET":
            return fail("attachments.error.request")
        operation = str(data.get("operation") or "").strip().lower()
        if operation in ("upload", "put"):
            return do_upload(ctx, args, data)
        if operation in ("download", "get", "fetch"):
            return do_download(ctx, args, data)
        return fail("attachments.error.request")
    except Exception as exc:
        return fail("attachments.error.request", detail=str(exc))
