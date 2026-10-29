import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

interface SavedGroup {
  id: number;
  name: string;
  accessMode: string;
  isDisabled: boolean;
  project: string;
  users: string[];
}

const NewGroup = () => {
  const { t } = useI18n();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [projectQuery, setProjectQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(
    null
  );
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const [userFilter, setUserFilter] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const [modes, setModes] = useState<string[]>(["R"]);

  const [savedGroup, setSavedGroup] = useState<SavedGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  useEffect(() => {
    api<{ groups: unknown[]; users: UserOption[]; projects: ProjectOption[] }>(
      GROUPS_ENDPOINT
    )
      .then((data) => {
        setUsers(data.users ?? []);
        setProjects(data.projects ?? []);
      })
      .catch(() => {
        // keep the form usable; the save request will surface server errors
      });
  }, []);

  const projectMatches = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    const base = selectedProject
      ? projects.filter((p) => p.id === selectedProject.id)
      : query
        ? projects.filter(
            (p) =>
              p.name.toLowerCase().includes(query) ||
              p.identifier.toLowerCase().includes(query)
          )
        : [];
    return base;
  }, [projects, projectQuery, selectedProject]);

  // Group name: <Project Identifier>_<CRUD letters in fixed order>.
  const groupName = useMemo(() => {
    if (!selectedProject || modes.length === 0) return "";
    const ordered = MODE_ORDER.filter((m) => modes.includes(m));
    return `${selectedProject.identifier}_${ordered.join("")}`;
  }, [selectedProject, modes]);

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
    if (!selectedProject) errors.project = "groups.error.projectRequired";
    if (modes.length === 0) errors.modes = "groups.error.modesRequired";
    if (selectedUsers.length === 0) errors.users = "groups.error.usersRequired";
    return errors;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || savedGroup) return;
    const errors = validate();
    setFieldErrors(errors);
    setBannerError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const data = await api<{ group: SavedGroup }>(GROUPS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          projectId: selectedProject!.id,
          accessModes: MODE_ORDER.filter((m) => modes.includes(m)),
          loginNames: selectedUsers,
        }),
      });
      setSavedGroup(data.group);
      toast.success(t("newGroup.saved"));
    } catch (error) {
      if (error instanceof ApiError && error.serverKey) {
        if (error.serverKey === "groups.error.nameTaken") {
          setFieldErrors((prev) => ({ ...prev, name: error.serverKey! }));
        } else if (error.serverKey === "groups.error.userNotFound") {
          setFieldErrors((prev) => ({ ...prev, users: error.serverKey! }));
        } else if (error.serverKey === "groups.error.projectNotFound") {
          setFieldErrors((prev) => ({ ...prev, project: error.serverKey! }));
        } else {
          setBannerError({
            key: error.serverKey,
            params: error.serverParams ?? undefined,
          });
        }
      } else {
        setBannerError({ key: "error.requestFailed", params: { status: "?" } });
      }
      toast.error(
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async () => {
    if (!savedGroup || busy) return;
    setBusy(true);
    setBannerError(null);
    try {
      const data = await api<{ group: SavedGroup }>(GROUPS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: savedGroup.isDisabled ? "enable" : "disable",
          id: savedGroup.id,
        }),
      });
      setSavedGroup(data.group);
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

  const locked = savedGroup !== null;

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-full";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground">
            {t("newGroup.title")}
          </h1>

          {bannerError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t(bannerError.key, bannerError.params)}
            </div>
          )}

          <form onSubmit={handleSave} noValidate className="space-y-4">
            <div className="relative">
              <label htmlFor="group-project" className={labelClass}>
                {t("newGroup.project")} *
              </label>
              <Input
                id="group-project"
                name="project"
                value={
                  selectedProject && projectQuery === ""
                    ? `${selectedProject.name} (${selectedProject.identifier})`
                    : projectQuery
                }
                onChange={(e) => {
                  setSelectedProject(null);
                  setProjectQuery(e.target.value);
                  setShowProjectDropdown(true);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.project;
                    delete next.name;
                    return next;
                  });
                }}
                onFocus={() => setShowProjectDropdown(true)}
                onBlur={() => {
                  // allow option clicks first
                  window.setTimeout(
                    () => setShowProjectDropdown(false),
                    150
                  );
                }}
                placeholder={t("newGroup.projectPlaceholder")}
                disabled={locked || saving}
                className={fieldClass}
              />
              {showProjectDropdown && !locked && projectMatches.length > 0 && (
                <ul
                  className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-background shadow-md"
                  role="listbox"
                >
                  {projectMatches.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedProject?.id === project.id}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setSelectedProject(project);
                          setProjectQuery("");
                          setShowProjectDropdown(false);
                          setFieldErrors((prev) => {
                            const next = { ...prev };
                            delete next.project;
                            delete next.name;
                            return next;
                          });
                        }}
                      >
                        <span>{project.name}</span>
                        <span className="text-muted-foreground">
                          {project.identifier}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {fieldErrors.project && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.project)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="group-users" className={labelClass}>
                {t("newGroup.users")} *
              </label>
              <Input
                id="group-users"
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
                disabled={locked || saving}
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
                          htmlFor={`group-user-${user.loginName}`}
                          className="flex items-center gap-2 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            name="users"
                            id={`group-user-${user.loginName}`}
                            checked={selectedUsers.includes(user.loginName)}
                            onChange={() => toggleUser(user.loginName)}
                            disabled={locked || saving}
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

            <div>
              <span className={labelClass}>
                {t("newGroup.rbac")} *
              </span>
              <div className="flex flex-wrap gap-4 rounded-md border border-input bg-muted/30 p-3">
                <label
                  htmlFor="rbac-c"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    name="rbac"
                    id="rbac-c"
                    checked={modes.includes("C")}
                    onChange={() => toggleMode("C")}
                    disabled={locked || saving}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span>{t("newGroup.modeCreate")}</span>
                </label>
                <label
                  htmlFor="rbac-r"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    name="rbac"
                    id="rbac-r"
                    checked={modes.includes("R")}
                    onChange={() => toggleMode("R")}
                    disabled={locked || saving}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span>{t("newGroup.modeRead")}</span>
                </label>
                <label
                  htmlFor="rbac-u"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    name="rbac"
                    id="rbac-u"
                    checked={modes.includes("U")}
                    onChange={() => toggleMode("U")}
                    disabled={locked || saving}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span>{t("newGroup.modeUpdate")}</span>
                </label>
                <label
                  htmlFor="rbac-d"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    name="rbac"
                    id="rbac-d"
                    checked={modes.includes("D")}
                    onChange={() => toggleMode("D")}
                    disabled={locked || saving}
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
              <label htmlFor="group-name" className={labelClass}>
                {t("newGroup.name")}
              </label>
              <Input
                id="group-name"
                name="groupName"
                value={groupName}
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

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="submit"
                disabled={locked || saving}
                aria-busy={saving}
              >
                {t("newGroup.save")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!savedGroup || busy}
                onClick={handleToggleDisabled}
              >
                {savedGroup?.isDisabled
                  ? t("newGroup.enable")
                  : t("newGroup.disable")}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/administration/groups/groups-list">
                  {t("newGroup.backToGroups")}
                </Link>
              </Button>
            </div>
          </form>

          {savedGroup && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("newGroup.statusPrefix")}: {savedGroup.isDisabled
                ? t("newGroup.statusDisabled")
                : t("newGroup.statusEnabled")}{" "}
              ({savedGroup.name})
            </p>
          )}
        </div>
      </div>
    </>
  );
};

export default NewGroup;
