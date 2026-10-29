import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const GROUPS_ENDPOINT = "/api/my/v1/groups";
const MODE_ORDER = ["C", "R", "U", "D"] as const;

interface ProjectOption {
  id: number;
  name: string;
  identifier: string;
}

interface UserOption {
  loginName: string;
  isDisabled: boolean;
}

interface GroupInfo {
  id: number;
  name: string;
  accessMode: string;
  isDisabled: boolean;
  project: string | null;
  users: string[];
}

const GroupEdit = () => {
  const { t } = useI18n();
  const { groupId } = useParams<{ groupId: string }>();

  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [modes, setModes] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState("");
  const [initialized, setInitialized] = useState(false);

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  const group =
    groups.find((g) => String(g.id) === groupId) ?? null;

  const projectOption = useMemo(() => {
    if (!group || !group.project) return null;
    return (
      projects.find(
        (p) =>
          p.name.toLowerCase() === group.project!.toLowerCase() ||
          p.identifier.toLowerCase() === group.project!.toLowerCase()
      ) ?? null
    );
  }, [groups, group, projects]);

  const load = async () => {
    setLoading(true);
    setNotFound(false);
    setInitialized(false);
    setBannerError(null);
    setFieldErrors({});
    try {
      const data = await api<{
        groups: GroupInfo[];
        users: UserOption[];
        projects: ProjectOption[];
      }>(GROUPS_ENDPOINT);
      setGroups(data.groups ?? []);
      setUsers(data.users ?? []);
      setProjects(data.projects ?? []);

      const found = (data.groups ?? []).find(
        (g) => String(g.id) === groupId
      );
      if (!found) {
        setNotFound(true);
        return;
      }
      setModes(MODE_ORDER.filter((m) => found.accessMode.includes(m)));
      setSelectedUsers(found.users ?? []);
      setInitialized(true);
    } catch (err) {
      const message =
        err instanceof ApiError && err.serverKey
          ? t(err.serverKey, err.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Preview of the derived group name after a mode change.
  const previewName = useMemo(() => {
    if (!projectOption || modes.length === 0) return group?.name ?? "";
    const ordered = MODE_ORDER.filter((m) => modes.includes(m));
    return `${projectOption.identifier}_${ordered.join("")}`;
  }, [projectOption, modes, group]);

  const filteredUsers = useMemo(() => {
    const query = userFilter.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => u.loginName.toLowerCase().includes(query));
  }, [users, userFilter]);

  const toggleUser = (loginName: string) => {
    setSelectedUsers((prev) =>
      prev.includes(loginName)
        ? prev.filter((u) => u !== loginName)
        : [...prev, loginName]
    );
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.users;
      return next;
    });
  };

  const toggleMode = (mode: string) => {
    setModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.modes;
      return next;
    });
  };

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (modes.length === 0) errors.modes = "groups.error.modesRequired";
    if (selectedUsers.length === 0) errors.users = "groups.error.usersRequired";
    return errors;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !group) return;
    const errors = validate();
    setFieldErrors(errors);
    setBannerError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      await api(GROUPS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update",
          id: group.id,
          accessModes: MODE_ORDER.filter((m) => modes.includes(m)),
          loginNames: selectedUsers,
        }),
      });
      await load();
      toast.success(t("groupEdit.saved"));
    } catch (err) {
      if (err instanceof ApiError && err.serverKey) {
        if (err.serverKey === "groups.error.nameTaken") {
          setFieldErrors((prev) => ({ ...prev, name: err.serverKey! }));
        } else if (err.serverKey === "groups.error.userNotFound") {
          setFieldErrors((prev) => ({ ...prev, users: err.serverKey! }));
        } else {
          setBannerError({
            key: err.serverKey,
            params: err.serverParams ?? undefined,
          });
        }
      } else {
        setBannerError({ key: "error.requestFailed", params: { status: "?" } });
      }
      toast.error(
        err instanceof ApiError && err.serverKey
          ? t(err.serverKey, err.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async () => {
    if (!group || busy) return;
    setBusy(true);
    setBannerError(null);
    try {
      await api(GROUPS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: group.isDisabled ? "enable" : "disable",
          id: group.id,
        }),
      });
      await load();
      toast.success(t("groupEdit.updated"));
    } catch (error) {
      const message =
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-full";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            {t("groupEdit.title")}
          </h1>
          {!loading && group && (
            <p className="mb-6 text-sm text-muted-foreground">
              {t("newGroup.name")}:{" "}
              <span className="font-medium">{group.name}</span>
              {" · "}
              {t("newGroup.statusPrefix")}:{" "}
              {group.isDisabled
                ? t("newGroup.statusDisabled")
                : t("newGroup.statusEnabled")}
            </p>
          )}

          {bannerError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t(bannerError.key, bannerError.params)}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("usersList.loading")}
            </p>
          ) : notFound || !group ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("groups.error.groupNotFound")}
            </div>
          ) : (
            <form onSubmit={handleSave} noValidate className="space-y-4">
              <div>
                <label htmlFor="edit-group-name" className={labelClass}>
                  {t("newGroup.name")}
                </label>
                <Input
                  id="edit-group-name"
                  name="groupName"
                  value={previewName}
                  readOnly
                  disabled
                  aria-readonly="true"
                  className={`${fieldClass} bg-muted/30 text-muted-foreground`}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("newGroup.nameAuto")}
                </p>
                {fieldErrors.name && (
                  <p className={fieldErrorClass}>{t(fieldErrors.name)}</p>
                )}
              </div>

              <div>
                <label htmlFor="edit-group-project" className={labelClass}>
                  {t("newGroup.project")}
                </label>
                <Input
                  id="edit-group-project"
                  name="groupProject"
                  value={
                    projectOption
                      ? `${projectOption.name} (${projectOption.identifier})`
                      : (group.project ?? "")
                  }
                  readOnly
                  disabled
                  aria-readonly="true"
                  className={`${fieldClass} bg-muted/30 text-muted-foreground`}
                />
              </div>

              <div>
                <span className={labelClass}>{t("newGroup.rbac")} *</span>
                <div className="flex flex-wrap gap-4 rounded-md border border-input bg-muted/30 p-3">
                  <label
                    htmlFor="edit-rbac-c"
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      name="rbac"
                      id="edit-rbac-c"
                      checked={modes.includes("C")}
                      onChange={() => toggleMode("C")}
                      disabled={saving}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>{t("newGroup.modeCreate")}</span>
                  </label>
                  <label
                    htmlFor="edit-rbac-r"
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      name="rbac"
                      id="edit-rbac-r"
                      checked={modes.includes("R")}
                      onChange={() => toggleMode("R")}
                      disabled={saving}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>{t("newGroup.modeRead")}</span>
                  </label>
                  <label
                    htmlFor="edit-rbac-u"
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      name="rbac"
                      id="edit-rbac-u"
                      checked={modes.includes("U")}
                      onChange={() => toggleMode("U")}
                      disabled={saving}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>{t("newGroup.modeUpdate")}</span>
                  </label>
                  <label
                    htmlFor="edit-rbac-d"
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      name="rbac"
                      id="edit-rbac-d"
                      checked={modes.includes("D")}
                      onChange={() => toggleMode("D")}
                      disabled={saving}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>{t("newGroup.modeDelete")}</span>
                  </label>
                </div>
                {fieldErrors.modes && (
                  <p className={fieldErrorClass}>{t(fieldErrors.modes)}</p>
                )}
              </div>

              <div>
                <label htmlFor="edit-group-users" className={labelClass}>
                  {t("newGroup.users")} *
                </label>
                <Input
                  id="edit-group-users"
                  name="userFilter"
                  value={userFilter}
                  onChange={(e) => {
                    setUserFilter(e.target.value);
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.users;
                      return next;
                    });
                  }}
                  placeholder={t("newGroup.userFilterPlaceholder")}
                  disabled={saving}
                  className={fieldClass}
                />
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-input bg-muted/30 p-2">
                  {filteredUsers.length === 0 ? (
                    <p className="px-1 py-0.5 text-xs text-muted-foreground">
                      {t("newGroup.noUsersMatch")}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {filteredUsers.map((user) => (
                        <li key={user.loginName}>
                          <label
                            htmlFor={`edit-group-user-${user.loginName}`}
                            className="flex items-center gap-2 text-sm text-foreground"
                          >
                            <input
                              type="checkbox"
                              name="users"
                              id={`edit-group-user-${user.loginName}`}
                              checked={selectedUsers.includes(
                                user.loginName
                              )}
                              onChange={() => toggleUser(user.loginName)}
                              disabled={saving}
                              className="h-4 w-4 rounded border-input accent-primary"
                            />
                            <span>
                              {user.loginName}
                              {user.isDisabled ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({t("newUser.statusDisabled")})
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {selectedUsers.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("newGroup.selectedUsers")}: {selectedUsers.join(", ")}
                  </p>
                )}
                {fieldErrors.users && (
                  <p className={fieldErrorClass}>{t(fieldErrors.users)}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button
                  type="submit"
                  disabled={saving || !initialized}
                  aria-busy={saving}
                >
                  {t("groupEdit.save")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={handleToggleDisabled}
                >
                  {group.isDisabled
                    ? t("newGroup.enable")
                    : t("newGroup.disable")}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link to="/administration/groups/groups-list">
                    {t("groupEdit.backToGroups")}
                  </Link>
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default GroupEdit;
