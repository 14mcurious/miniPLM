SCHEMA = '"MiniPLM"'

STATEMENTS = [
    'CREATE SCHEMA IF NOT EXISTS "MiniPLM"',
    # Users: identity + credentials. email, name and surname are immutable
    # after creation (enforced by the application layer, not by the DB).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."users" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  login_name TEXT NOT NULL UNIQUE,"
        "  password_hash TEXT NOT NULL,"
        "  email TEXT NOT NULL,"
        "  name TEXT NOT NULL,"
        "  surname TEXT NOT NULL,"
        "  company TEXT,"
        "  notify_email BOOLEAN NOT NULL DEFAULT FALSE,"
        "  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    # Groups: access mode belongs to the group (per the New User spec, each
    # group shows its project list and its access mode).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."groups" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  name TEXT NOT NULL UNIQUE,"
        "  access_mode TEXT NOT NULL DEFAULT 'read'"
        ")"
    ),
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."group_projects" ('
        '  group_id BIGINT NOT NULL REFERENCES "MiniPLM"."groups"(id) ON DELETE CASCADE,'
        "  project_name TEXT NOT NULL,"
        "  PRIMARY KEY (group_id, project_name)"
        ")"
    ),
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."user_groups" ('
        '  user_id BIGINT NOT NULL REFERENCES "MiniPLM"."users"(id) ON DELETE CASCADE,'
        '  group_id BIGINT NOT NULL REFERENCES "MiniPLM"."groups"(id) ON DELETE CASCADE,'
        "  PRIMARY KEY (user_id, group_id)"
        ")"
    ),
    # Application settings (password policy, ...), idempotent seed.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."settings" ('
        "  key TEXT PRIMARY KEY,"
        "  value TEXT NOT NULL"
        ")"
    ),
    # Durable seed marker table: records which idempotent seeds have been
    # applied, so setup reruns stay no-ops.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."seed_marker" ('
        "  name TEXT PRIMARY KEY,"
        "  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
]


def main(args, ctx=None):
    if not ctx or not hasattr(ctx, "POSTGRESQL"):
        return {"ok": False, "error": "Database not configured"}

    conn = ctx.POSTGRESQL
    try:
        with conn.cursor() as cur:
            for stmt in STATEMENTS:
                cur.execute(stmt)
            # Idempotent seed of the default password policy, guarded by the
            # durable seed marker: applied only once, reruns are no-ops.
            cur.execute(
                'SELECT 1 FROM "MiniPLM"."settings" WHERE key = %s',
                ("min_password_length",),
            )
            if cur.fetchone() is None:
                cur.execute(
                    'INSERT INTO "MiniPLM"."settings" (key, value)'
                    " VALUES (%s, %s)",
                    ("min_password_length", "12"),
                )
                cur.execute(
                    'INSERT INTO "MiniPLM"."seed_marker" (name) VALUES (%s)',
                    ("settings_default_password_policy",),
                )
        conn.commit()
    except Exception as exc:  # pragma: no cover - defensive
        conn.rollback()
        return {"ok": False, "error": f"setup failed: {exc}"}

    return {"ok": True, "schema": "MiniPLM"}
