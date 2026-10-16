import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import BackLink from "@/components/BackLink";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";

const GROUPS_ENDPOINT = "/api/my/v1/groups";

interface UserOption {
  id: number;
  loginName: string;
  isDisabled: boolean;
}

interface GroupRow {
  id: number;
  name: string;
  accessMode: string;
  isDisabled: boolean;
  project: string | null;
  users: string[];
}

const GroupsList = () => {
  const { t } = useI18n();

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        groups: GroupRow[];
        users: UserOption[];
        projects: unknown[];
      }>(GROUPS_ENDPOINT);
      setGroups(data.groups ?? []);
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

  const userByLoginName = useMemo(() => {
    const map = new Map<string, UserOption>();
    for (const user of users) map.set(user.loginName, user);
    return map;
  }, [users]);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => {
      if (group.name.toLowerCase().includes(needle)) return true;
      if ((group.project ?? "").toLowerCase().includes(needle)) return true;
      if (group.users.some((u) => u.toLowerCase().includes(needle)))
        return true;
      return false;
    });
  }, [groups, query]);

  const linkClass =
    "text-primary underline-offset-2 hover:underline break-all";
  const dash = t("usersList.none");

  return (
    <>
      <BackLink to="/administration/groups" label={t("groups.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground">
            {t("groupsList.title")}
          </h1>

          <div className="mb-4 max-w-md">
            <label
              htmlFor="groups-list-search"
              className="mb-1 block text-sm font-medium leading-none text-foreground"
            >
              {t("groupsList.searchLabel")}
            </label>
            <Input
              id="groups-list-search"
              name="groupsListSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("groupsList.searchPlaceholder")}
              className="w-full"
            />
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("groupsList.loading")}
            </p>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("groupsList.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      {t("groupsList.group")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("groupsList.loginNames")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.length === 0 ? (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-3 py-4 text-muted-foreground"
                      >
                        {t("groupsList.noMatches")}
                      </td>
                    </tr>
                  ) : (
                    visibleGroups.map((group) => (
                      <tr key={group.id} className="border-b last:border-0">
                        <td className="px-3 py-2 align-top text-foreground">
                          <Link
                            to={`/administration/groups/group-edit/${group.id}`}
                            className={linkClass}
                          >
                            {group.name}
                          </Link>
                          {group.isDisabled ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({t("newGroup.statusDisabled")})
                            </span>
                          ) : null}
                          {group.project ? (
                            <div className="text-xs text-muted-foreground">
                              {t("newGroup.project")}: {group.project}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {group.users.length === 0 ? (
                            <span className="text-muted-foreground">
                              {dash}
                            </span>
                          ) : (
                            <ul className="space-y-1">
                              {group.users.map((loginName) => {
                                const user = userByLoginName.get(loginName);
                                return (
                                  <li key={loginName}>
                                    {user ? (
                                      <Link
                                        to={`/administration/users/user-edit/${user.id}`}
                                        className={linkClass}
                                      >
                                        {loginName}
                                      </Link>
                                    ) : (
                                      <span>{loginName}</span>
                                    )}
                                    {user?.isDisabled ? (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        ({t("newUser.statusDisabled")})
                                      </span>
                                    ) : null}
                                  </li>
                                );
                              })}
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

export default GroupsList;
