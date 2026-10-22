"""Shared OTP + SMTP helpers for the MiniPLM profile action.

A self-service profile change (email, password, name/surname) is
confirmed with a one-time code emailed to the user's CURRENT mailbox
(the OLD address when the email itself is being changed). When no SMTP
transport is configured (Security Settings page) the code is returned
to the caller as ``demoOtp`` so the flow stays testable, mirroring the
login OTP behavior.

Redis layout (keys built from ctx.REDIS_PREFIX):
  profile:otp:{userId}  {"code", "expiresAt", "attempts", "kind", "payload"}
"""

import re
import secrets
import smtplib
import time
import json

from email.message import EmailMessage

OTP_MAX_ATTEMPTS = 5
SMTP_TIMEOUT_SECONDS = 15
EMAIL_FIELD_MAX_LEN = 255
EMAIL_ADDRESS_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def redis_key(ctx, name):
    return f"{getattr(ctx, 'REDIS_PREFIX', '') or ''}{name}"


def get_otp_ttl(cur):
    cur.execute(
        "SELECT value FROM \"MiniPLM\".\"settings\" WHERE key = %s",
        ("otp_ttl_seconds",),
    )
    row = cur.fetchone()
    if row:
        try:
            return max(60, int(row[0]))
        except (TypeError, ValueError):
            pass
    return 300


def _setting_value(cur, key):
    cur.execute(
        'SELECT value FROM "MiniPLM"."settings" WHERE key = %s',
        (key,),
    )
    row = cur.fetchone()
    if row is None:
        return ""
    return str(row[0] or "").strip()


def get_email_settings(cur):
    """SMTP configuration; None when the transport is not fully configured."""
    host = _setting_value(cur, "email_smtp_host")
    port_raw = _setting_value(cur, "email_smtp_port")
    from_address = _setting_value(cur, "email_from_address")
    if not host or not port_raw or not from_address:
        return None
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        return None
    if not 1 <= port <= 65535:
        return None
    return {
        "host": host,
        "port": port,
        "username": _setting_value(cur, "email_smtp_username"),
        "password": _setting_value(cur, "email_smtp_password"),
        "useTls": _setting_value(cur, "email_smtp_use_tls").lower() == "true",
        "from": from_address,
    }


def send_otp_email(settings, to_address, code, ttl_seconds, subject):
    """Send a one-time code to ``to_address`` through the configured SMTP.

    Raises on any transport failure; the caller maps it to a generic
    error so infrastructure details never reach the browser.
    """
    msg = EmailMessage()
    msg["From"] = settings["from"]
    msg["To"] = to_address
    msg["Subject"] = subject
    minutes = max(1, ttl_seconds // 60)
    msg.set_content(
        f"The one-time confirmation code is: {code}\n\n"
        f"The code expires in about {minutes} minute(s).\n"
        "If you did not request this code, you can safely ignore this email.\n"
    )
    server = smtplib.SMTP(
        settings["host"], settings["port"], timeout=SMTP_TIMEOUT_SECONDS
    )
    try:
        if settings["useTls"]:
            server.starttls()
        if settings["username"]:
            server.login(settings["username"], settings["password"])
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def issue_otp(ctx, cur, user_id, kind, payload):
    """Stage a pending profile change. Returns (code, ttl)."""
    ttl = get_otp_ttl(cur)
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    now = int(time.time())
    record = json.dumps(
        {
            "code": code,
            "expiresAt": now + ttl,
            "attempts": 0,
            "kind": kind,
            "payload": payload,
        }
    )
    ctx.REDIS.set(redis_key(ctx, f"profile:otp:{user_id}"), record, ex=ttl)
    return code, ttl


def consume_otp(ctx, user_id, otp):
    """Verify the submitted OTP.

    Returns (True, record) on success, (False, reason) otherwise, where
    the record carries the staged ``kind`` and ``payload``. The record
    is deleted on success or after the last allowed attempt.
    """
    key = redis_key(ctx, f"profile:otp:{user_id}")
    try:
        raw = ctx.REDIS.get(key)
    except Exception:
        raw = None
    if raw is None:
        return False, "none"
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    try:
        record = json.loads(raw)
    except Exception:
        return False, "none"
    code = str(record.get("code") or "")
    expires_at = int(record.get("expiresAt") or 0)
    attempts = int(record.get("attempts") or 0)
    now = int(time.time())
    if expires_at <= now or attempts >= OTP_MAX_ATTEMPTS:
        try:
            ctx.REDIS.delete(key)
        except Exception:
            pass
        return False, "expired"
    if secrets.compare_digest(code, str(otp or "")):
        try:
            ctx.REDIS.delete(key)
        except Exception:
            pass
        return True, record
    attempts += 1
    if attempts >= OTP_MAX_ATTEMPTS:
        try:
            ctx.REDIS.delete(key)
        except Exception:
            pass
        return False, "expired"
    try:
        remaining = max(1, expires_at - now)
        ctx.REDIS.set(
            key,
            json.dumps({"code": code, "expiresAt": expiresAt, "attempts": attempts,
                        "kind": record.get("kind"), "payload": record.get("payload")}),
            ex=remaining,
        )
    except Exception:
        pass
    return False, "wrong"
