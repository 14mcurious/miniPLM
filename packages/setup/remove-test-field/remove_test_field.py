"""One-shot idempotent cleanup action.

During the MD field type verification (2026-10-22) an accidental test
write added an ``ad_hoc`` string field (value "x") to work container
WC-000023. The container update merge keeps existing fields, so the
application API cannot remove it; this action restores the stored field
list by dropping exactly that test artifact. It is a no-op when the
field is absent, so it is safe to run again.
"""

import json


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL"):
        return {"ok": False, "error": "Database not configured"}

    conn = ctx.POSTGRESQL
    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, fields FROM "MiniPLM"."work_containers"'
            " WHERE identifier = %s",
            ("WC-000023",),
        )
        row = cur.fetchone()
        if not row:
            # The target container is gone (deleted through the app): the
            # test artifact cannot exist anymore, so the cleanup is done.
            return {
                "ok": True,
                "removed": False,
                "detail": "work container WC-000023 not found; nothing to do",
            }
        container_id, raw_fields = row
        fields = raw_fields
        if isinstance(fields, str):
            try:
                fields = json.loads(fields)
            except (TypeError, ValueError):
                fields = []
        if not isinstance(fields, list):
            fields = []
        kept = [
            item
            for item in fields
            if not (
                isinstance(item, dict)
                and item.get("name") == "ad_hoc"
                and item.get("type") == "string"
                and item.get("value") == "x"
            )
        ]
        if len(kept) == len(fields):
            return {
                "ok": True,
                "removed": False,
                "detail": "test field not present; nothing to do",
            }
        cur.execute(
            'UPDATE "MiniPLM"."work_containers" SET fields = %s WHERE id = %s',
            (json.dumps(kept), container_id),
        )
    conn.commit()
    return {
        "ok": True,
        "removed": True,
        "keptFields": len(kept),
        "detail": f"removed {len(fields) - len(kept)} test field(s) from WC-000023",
    }
