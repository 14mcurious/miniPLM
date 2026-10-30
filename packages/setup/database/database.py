import bcrypt
import json

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
    # Idempotent cleanup of orphan groups: a group without any project link
    # is broken (the group is created with a project and update_group never
    # removes the link), so it can only exist after its project was
    # deleted. The SysAdmin group is the single legitimate exception (it
    # grants no work area access by design) and is preserved.
    (
        'DELETE FROM "MiniPLM"."groups" g'
        " WHERE g.name <> 'SysAdmin'"
        ' AND NOT EXISTS ('
        '  SELECT 1 FROM "MiniPLM"."group_projects" gp'
        '  WHERE gp.group_id = g.id'
        ')'
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
    # Work spaces: hierarchical (parent_id), scoped to a project. A project
    # contains work spaces; a work space contains zero or more work spaces
    # and zero or more work containers.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."workspaces" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  project_id BIGINT NOT NULL REFERENCES \"MiniPLM\".\"projects\"(id) ON DELETE CASCADE,"
        "  name TEXT NOT NULL,"
        "  title TEXT,"
        "  parent_id BIGINT REFERENCES \"MiniPLM\".\"workspaces\"(id) ON DELETE CASCADE,"
        "  created_by BIGINT REFERENCES \"MiniPLM\".\"users\"(id) ON DELETE SET NULL,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    (
        'CREATE UNIQUE INDEX IF NOT EXISTS workspace_name_uniq_idx'
        ' ON "MiniPLM"."workspaces" (project_id, lower(name))'
    ),
    # Work containers: entity living inside a work space (a container is
    # always attached to exactly one work space). identifier is the unique
    # system id (WC-000001 style).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."work_containers" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  identifier TEXT NOT NULL UNIQUE,"
        "  project_id BIGINT NOT NULL REFERENCES \"MiniPLM\".\"projects\"(id) ON DELETE CASCADE,"
        "  workspace_id BIGINT REFERENCES \"MiniPLM\".\"workspaces\"(id) ON DELETE CASCADE,"
        "  title TEXT,"
        "  description TEXT,"
        "  author_id BIGINT REFERENCES \"MiniPLM\".\"users\"(id) ON DELETE SET NULL,"
        "  progress TEXT,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    # History / audit trail of work containers: who created or modified the
    # entity, when, and which fields changed.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."work_container_history" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  work_container_id BIGINT NOT NULL REFERENCES \"MiniPLM\".\"work_containers\"(id) ON DELETE CASCADE,"
        "  user_id BIGINT REFERENCES \"MiniPLM\".\"users\"(id) ON DELETE SET NULL,"
        "  action TEXT NOT NULL,"
        "  changed_fields TEXT,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    # Work instance templates: JSON definition of the fields a work instance
    # of a project can carry (field name, type, optional description, and
    # for custom-type fields the referenced custom type).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."work_instance_templates" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  project_id BIGINT NOT NULL REFERENCES \"MiniPLM\".\"projects\"(id) ON DELETE CASCADE,"
        "  name TEXT NOT NULL,"
        "  definition JSONB NOT NULL DEFAULT '[]',"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    (
        'CREATE UNIQUE INDEX IF NOT EXISTS template_name_uniq_idx'
        ' ON "MiniPLM"."work_instance_templates" (project_id, lower(name))'
    ),
    # Optional icon (Lucide icon name) associated with a template: it is
    # shown next to the title of every work instance / work container that
    # uses the template (search lists and detail pages) so the element
    # type is easy to recognise. NULL = no icon.
    (
        'ALTER TABLE "MiniPLM"."work_instance_templates"'
        ' ADD COLUMN IF NOT EXISTS icon_name TEXT'
    ),
    # Work instances: documents/files/entities belonging to a work container.
    # instance_id is the string id (WI-000001 style); fields is the JSON
    # array of {name, type, value, ...} entries; assignees is the JSON array
    # of user ids.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."work_instances" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  instance_id TEXT NOT NULL UNIQUE,"
        "  project_id BIGINT NOT NULL REFERENCES \"MiniPLM\".\"projects\"(id) ON DELETE CASCADE,"
        "  work_container_id BIGINT NOT NULL REFERENCES \"MiniPLM\".\"work_containers\"(id) ON DELETE CASCADE,"
        "  title TEXT NOT NULL,"
        "  author_id BIGINT REFERENCES \"MiniPLM\".\"users\"(id) ON DELETE SET NULL,"
        "  progress TEXT,"
        "  assignees JSONB NOT NULL DEFAULT '[]',"
        "  template_id BIGINT REFERENCES \"MiniPLM\".\"work_instance_templates\"(id) ON DELETE SET NULL,"
        "  fields JSONB NOT NULL DEFAULT '[]',"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    # Custom types: enumerated types based on number/date/string, single or
    # multi select, managed in the Configuration area (standard types and
    # workflow/progress types).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."custom_types" ('
        "  id BIGSERIAL PRIMARY KEY,"
        "  name TEXT NOT NULL,"
        "  value_type TEXT NOT NULL DEFAULT 'string',"
        "  multi_select BOOLEAN NOT NULL DEFAULT FALSE,"
        "  category TEXT NOT NULL DEFAULT 'standard',"
        "  options JSONB NOT NULL DEFAULT '[]',"
        "  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    (
        'CREATE UNIQUE INDEX IF NOT EXISTS custom_type_name_uniq_idx'
        ' ON "MiniPLM"."custom_types" (lower(name))'
    ),
    # Workflow metadata on custom types: the initial state (one of the
    # option values) and the allowed state-to-state transitions. Meaningful
    # only for workflow (progress) types; harmless for standard types.
    (
        'ALTER TABLE "MiniPLM"."custom_types"'
        ' ADD COLUMN IF NOT EXISTS initial_state TEXT'
    ),
    (
        'ALTER TABLE "MiniPLM"."custom_types"'
        " ADD COLUMN IF NOT EXISTS transitions JSONB NOT NULL DEFAULT '[]'"
    ),
    # Workflow role list association: which role list applies to this
    # workflow type (NULL = no role constraints).
    (
        'ALTER TABLE "MiniPLM"."custom_types"'
        ' ADD COLUMN IF NOT EXISTS role_list_id BIGINT NULL'
    ),
    # Workflow roles: assignable to users, referenced by role lists and by
    # workflow transitions (transition.role = role name).
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."roles" ('
        '  id BIGSERIAL PRIMARY KEY,'
        '  name TEXT NOT NULL,'
        '  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),'
        '  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()'
        ')'
    ),
    (
        'CREATE UNIQUE INDEX IF NOT EXISTS role_name_uniq_idx'
        ' ON "MiniPLM"."roles" (lower(name))'
    ),
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."user_roles" ('
        '  user_id BIGINT NOT NULL REFERENCES "MiniPLM"."users"(id) ON DELETE CASCADE,'
        '  role_id BIGINT NOT NULL REFERENCES "MiniPLM"."roles"(id) ON DELETE CASCADE,'
        '  PRIMARY KEY (user_id, role_id)'
        ')'
    ),
    # Named lists of roles, reusable across workflow types.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."role_lists" ('
        '  id BIGSERIAL PRIMARY KEY,'
        '  name TEXT NOT NULL,'
        '  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),'
        '  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()'
        ')'
    ),
    (
        'CREATE UNIQUE INDEX IF NOT EXISTS role_list_name_uniq_idx'
        ' ON "MiniPLM"."role_lists" (lower(name))'
    ),
    # Work containers follow templates just like work instances: the
    # shared template reference and the template field values stored on
    # the container. Progress is a template field, never a default one.
    (
        'ALTER TABLE "MiniPLM"."work_containers"'
        ' ADD COLUMN IF NOT EXISTS template_id BIGINT'
        ' REFERENCES "MiniPLM"."work_instance_templates"(id) ON DELETE SET NULL'
    ),
    (
        'ALTER TABLE "MiniPLM"."work_containers"'
        " ADD COLUMN IF NOT EXISTS fields JSONB NOT NULL DEFAULT '[]'"
    ),
    # Legacy global workflow-progress-type designation (removed): the
    # progress type is now selected per template. Drop the deprecated
    # setting row when present (idempotent no-op on fresh instances).
    (
        'DELETE FROM "MiniPLM"."settings"'
        " WHERE key = 'workflow_progress_type'"
    ),
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."role_list_members" ('
        '  role_list_id BIGINT NOT NULL REFERENCES "MiniPLM"."role_lists"(id) ON DELETE CASCADE,'
        '  role_id BIGINT NOT NULL REFERENCES "MiniPLM"."roles"(id) ON DELETE CASCADE,'
        '  PRIMARY KEY (role_list_id, role_id)'
        ')'
    ),
    # Work containers always live inside a work space. Idempotent migration
    # for containers created before the rule: projects with orphan
    # containers but no work space get a default work space, orphan
    # containers are attached to the first work space of their project, and
    # the NOT NULL constraint is enforced.
    (
        "INSERT INTO \"MiniPLM\".\"workspaces\" (project_id, name, title, parent_id, created_by, created_at, updated_at)"
        " SELECT p.id, 'Workspace', 'Default workspace', NULL, NULL, now(), now()"
        " FROM \"MiniPLM\".\"projects\" p"
        " WHERE EXISTS (SELECT 1 FROM \"MiniPLM\".\"work_containers\" c WHERE c.project_id = p.id AND c.workspace_id IS NULL)"
        " AND NOT EXISTS (SELECT 1 FROM \"MiniPLM\".\"workspaces\" w WHERE w.project_id = p.id)"
    ),
    (
        "UPDATE \"MiniPLM\".\"work_containers\" c SET workspace_id = sub.ws_id"
        " FROM (SELECT project_id, min(id) AS ws_id FROM \"MiniPLM\".\"workspaces\" GROUP BY project_id) sub"
        " WHERE c.workspace_id IS NULL AND c.project_id = sub.project_id"
    ),
    (
        'ALTER TABLE "MiniPLM"."work_containers" ALTER COLUMN workspace_id SET NOT NULL'
    ),
    (
        'CREATE INDEX IF NOT EXISTS work_containers_workspace_idx'
        ' ON "MiniPLM"."work_containers" (workspace_id)'
    ),
    # Display field rename: the "name" field of work instances and work
    # containers is replaced by "title" (free-form string, no character
    # constraints). Idempotent migration for rows created before the
    # rename: work_instances.name is renamed to work_instances.title and
    # work_containers.name is merged into work_containers.title (backfill
    # the title from the name when it is empty, then drop the column).
    (
        "DO $$ BEGIN"
        " IF EXISTS (SELECT 1 FROM information_schema.columns"
        "  WHERE table_schema = 'MiniPLM' AND table_name = 'work_instances' AND column_name = 'name')"
        " THEN"
        "   IF NOT EXISTS (SELECT 1 FROM information_schema.columns"
        "    WHERE table_schema = 'MiniPLM' AND table_name = 'work_instances' AND column_name = 'title')"
        "   THEN"
        '     ALTER TABLE "MiniPLM"."work_instances" RENAME COLUMN name TO title;'
        "   ELSE"
        '     UPDATE "MiniPLM"."work_instances" SET title = name'
        "     WHERE title IS NULL OR title = '';"
        '     ALTER TABLE "MiniPLM"."work_instances" DROP COLUMN name;'
        "   END IF;"
        " END IF;"
        " END $$"
    ),
    (
        "DO $$ BEGIN"
        " IF EXISTS (SELECT 1 FROM information_schema.columns"
        "  WHERE table_schema = 'MiniPLM' AND table_name = 'work_containers' AND column_name = 'name')"
        " THEN"
        '   UPDATE "MiniPLM"."work_containers" SET title = name'
        "   WHERE title IS NULL OR title = '';"
        '   ALTER TABLE "MiniPLM"."work_containers" DROP COLUMN name;'
        " END IF;"
        " END $$"
    ),
    # Markdown images: private image store backing the "insert image from
    # disk" feature of the MD editor. Bytes live in the S3 data bucket
    # (md-images/ prefix); id is the stable reference kept in the markdown
    # source (/api/my/v1/md-image?img=<id>). Updating overwrites the object
    # under the same id; deleting removes object + row.
    (
        'CREATE TABLE IF NOT EXISTS "MiniPLM"."md_images" ('
        "  id TEXT PRIMARY KEY,"
        "  s3_key TEXT NOT NULL,"
        "  file_name TEXT NOT NULL,"
        "  content_type TEXT NOT NULL,"
        "  size_bytes BIGINT NOT NULL,"
        "  created_by BIGINT REFERENCES \"MiniPLM\".\"users\"(id) ON DELETE SET NULL,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
        ")"
    ),
    (
        'CREATE INDEX IF NOT EXISTS md_images_updated_idx'
        ' ON "MiniPLM"."md_images" (updated_at DESC)'
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
            # Login name / password policy defaults (administrator-
            # configurable in the Security Settings page): strong password
            # complexity and short alphanumeric-only login names.
            for key, value in (
                ("password_require_uppercase", "true"),
                ("password_require_lowercase", "true"),
                ("password_require_digit", "true"),
                ("password_require_special", "true"),
                ("login_name_alnum_only", "true"),
                ("login_name_min_length", "3"),
                ("login_name_max_length", "32"),
            ):
                cur.execute(
                    'INSERT INTO "MiniPLM"."settings" (key, value)'
                    " VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                    (key, value),
                )
            # Idempotent seed of the search-results table columns
            # (administrator-configurable in the Configuration page): the
            # extra columns shown next to name/title, per result category.
            cur.execute(
                'SELECT 1 FROM "MiniPLM"."settings" WHERE key = %s',
                ("search_columns",),
            )
            if cur.fetchone() is None:
                cur.execute(
                    'INSERT INTO "MiniPLM"."settings" (key, value) VALUES (%s, %s)',
                    (
                        "search_columns",
                        json.dumps(
                            {
                                "workspace": ["title", "parent", "updated"],
                                "workcontainer": ["title", "progress", "author", "updated"],
                                "workinstance": ["progress", "assignees", "template", "updated"],
                            }
                        ),
                    ),
                )
                cur.execute(
                    'INSERT INTO "MiniPLM"."seed_marker" (name) VALUES (%s)',
                    ("settings_default_search_columns",),
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
