import bcrypt

SCHEMA = '"MiniPLM"'

SYSADMIN_GROUP = "SysAdmin"
DEFAULT_ADMIN_LOGIN = "admin"
DEFAULT_ADMIN_PASSWORD = "Change m3"

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
        "  access_mode TEXT NOT NULL DEFAULT 'read',"
        "  is_disabled BOOLEAN NOT NULL DEFAULT FALSE"
        ")"
    ),
    # Idempotent migration for pre-existing groups tables.
    (
        'ALTER TABLE "MiniPLM"."groups" ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE'
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
    # Projects: hierarchical structure. identifier is derived from name
    # (spaces removed) and must be unique system-wide (case-insensitive);
    # parent_id = NULL marks a root (main) project; level = number of
    # sub-project levels below the root (root = 0).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."projects" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  name TEXT NOT NULL,"
        "  identifier TEXT NOT NULL,"
        "  parent_id BIGINT REFERENCES \"MiniPLM\".\"projects\"(id) ON DELETE CASCADE,"
        "  level INTEGER NOT NULL DEFAULT 0,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    # Case-insensitive uniqueness of the derived identifier. The index name
    # is unqualified (Postgres places it in the table's schema).
    (
        'CREATE UNIQUE INDEX IF NOT EXISTS projects_identifier_uniq_idx'
        ' ON "MiniPLM"."projects" (lower(identifier))'
    ),
    # Application settings (password policy, project depth policy, ...),
    # idempotent seed.
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
            # Idempotent seed of the default sub-project depth policy
            # (administrator-configurable, default 10).
            cur.execute(
                'SELECT 1 FROM "MiniPLM"."settings" WHERE key = %s',
                ("max_subproject_levels",),
            )
            if cur.fetchone() is None:
                cur.execute(
                    'INSERT INTO "MiniPLM"."settings" (key, value)'
                    " VALUES (%s, %s)",
                    ("max_subproject_levels", "10"),
                )
                cur.execute(
                    'INSERT INTO "MiniPLM"."seed_marker" (name) VALUES (%s)',
                    ("settings_default_subproject_levels",),
                )
            # Session policy defaults (administrator-configurable in the
            # Configuration page): 6 hour sessions, extension prompt 10
            # minutes before expiry, 5 minute OTP validity.
            for key, value in (
                ("session_duration_hours", "6"),
                ("session_warning_minutes", "10"),
                ("otp_ttl_seconds", "300"),
                ("email_provider", "none"),
            ):
                cur.execute(
                    'INSERT INTO "MiniPLM"."settings" (key, value)'
                    " VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                    (key, value),
                )
            # Idempotent seed of the special SysAdmin group. It has no
            # project attachment, so by default it grants no work area
            # access; its members can enter the Administration area only.
            cur.execute(
                'SELECT 1 FROM "MiniPLM"."groups" WHERE name = %s',
                (SYSADMIN_GROUP,),
            )
            if cur.fetchone() is None:
                cur.execute(
                    'INSERT INTO "MiniPLM"."groups"'
                    " (name, access_mode, is_disabled) VALUES (%s, 'read', FALSE)",
                    (SYSADMIN_GROUP,),
                )
                cur.execute(
                    'INSERT INTO "MiniPLM"."seed_marker" (name) VALUES (%s)',
                    ("group_sysadmin",),
                )
            # Idempotent seed of the default administrator account
            # (login "admin", default password "Change m3", member of
            # SysAdmin). Never overwrites an existing account.
            cur.execute(
                'SELECT 1 FROM "MiniPLM"."users" WHERE login_name = %s',
                (DEFAULT_ADMIN_LOGIN,),
            )
            if cur.fetchone() is None:
                password_hash = bcrypt.hashpw(
                    DEFAULT_ADMIN_PASSWORD.encode("utf-8"),
                    bcrypt.gensalt(rounds=10),
                ).decode("utf-8")
                cur.execute(
                    'INSERT INTO "MiniPLM"."users"'
                    " (login_name, password_hash, email, name, surname, company,"
                    "  notify_email, is_disabled)"
                    " VALUES (%s, %s, %s, %s, %s, %s, FALSE, FALSE)",
                    (
                        DEFAULT_ADMIN_LOGIN,
                        password_hash,
                        "admin@miniplm.local",
                        "Administrator",
                        "System",
                        None,
                    ),
                )
                cur.execute(
                    'SELECT id FROM "MiniPLM"."users" WHERE login_name = %s',
                    (DEFAULT_ADMIN_LOGIN,),
                )
                admin_row = cur.fetchone()
                cur.execute(
                    'SELECT id FROM "MiniPLM"."groups" WHERE name = %s',
                    (SYSADMIN_GROUP,),
                )
                sysadmin_row = cur.fetchone()
                if admin_row and sysadmin_row:
                    cur.execute(
                        'INSERT INTO "MiniPLM"."user_groups" (user_id, group_id)'
                        " VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (admin_row[0], sysadmin_row[0]),
                    )
                cur.execute(
                    'INSERT INTO "MiniPLM"."seed_marker" (name) VALUES (%s)',
                    ("user_default_admin",),
                )
        conn.commit()
    except Exception as exc:  # pragma: no cover - defensive
        conn.rollback()
        return {"ok": False, "error": f"setup failed: {exc}"}

    return {"ok": True, "schema": "MiniPLM"}
