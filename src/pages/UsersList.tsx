import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import BackLink from "@/components/BackLink";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";

const USERS_ENDPOINT = "/api/my/v1/users";

interface ProjectRef {
  id: number;
  name: string;
}

interface UserGroup {
  id: number;
  name: string;
  accessMode: string;
  projects: ProjectRef[];
}

interface UserRow {
  id: number;
  loginName: string;
  isDisabled: boolean;
  groups: UserGroup[];
  projects: ProjectRef[];
}

const UsersList = () => {
  const { t } = useI18n();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ users: UserRow[] }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "list" }),
      });
      setUsers(data.users ?? []);
    } catch (err) {
      const message =
        err instanceof ApiError && err.serverKey
          ? t(err.serverKey, err.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" });
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => {
      if (user.loginName.toLowerCase().includes(needle)) return true;
      if (user.groups.some((g) => g.name.toLowerCase().includes(needle)))
        return true;
      if (user.projects.some((p) => p.name.toLowerCase().includes(needle)))
        return true;
      return false;
    });
  }, [users, query]);

  const linkClass =
    "text-primary underline-offset-2 hover:underline break-all";
  const dash = t("usersList.none");

  return (
    <>
      <BackLink to="/administration/users" label={t("users.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground">
            {t("usersList.title")}
          </h1>

          <div className="mb-4 max-w-md">
            <label
              htmlFor="users-list-search"
              className="mb-1 block text-sm font-medium leading-none text-foreground"
            >
              {t("usersList.searchLabel")}
            </label>
            <Input
              id="users-list-search"
              name="usersListSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("usersList.searchPlaceholder")}
              className="w-full"
            />
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("usersList.loading")}
            </p>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("usersList.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      {t("usersList.loginName")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("usersList.groups")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("usersList.projects")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-muted-foreground"
                      >
                        {t("usersList.noMatches")}
                      </td>
                    </tr>
                  ) : (
                    visibleUsers.map((user) => (
                      <tr key={user.id} className="border-b last:border-0">
                        <td className="px-3 py-2 align-top text-foreground">
                          <Link
                            to={`/administration/users/user-edit/${user.id}`}
                            className={linkClass}
                          >
                            {user.loginName}
                          </Link>
                          {user.isDisabled ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({t("newUser.statusDisabled")})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {user.groups.length === 0 ? (
                            <span className="text-muted-foreground">
                              {dash}
                            </span>
                          ) : (
                            <ul className="space-y-1">
                              {user.groups.map((group) => (
                                <li key={group.id}>
                                  <Link
                                    to={`/administration/groups/group-edit/${group.id}`}
                                    className={linkClass}
                                  >
                                    {group.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {user.projects.length === 0 ? (
                            <span className="text-muted-foreground">
                              {dash}
                            </span>
                          ) : (
                            <ul className="space-y-1">
                              {user.projects.map((project) => (
                                <li key={project.id}>
                                  <Link
                                    to={`/administration/projects/project-edit/${project.id}`}
                                    className={linkClass}
                                  >
                                    {project.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default UsersList;
