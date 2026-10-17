import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchGroup, SearchRow } from "@/lib/types";

const SEARCH_ENDPOINT = "/api/my/v1/search";

const CATEGORY_KEYS: Record<string, string> = {
  workspace: "wa.categoryWorkspace",
  workcontainer: "wa.categoryContainer",
  workinstance: "wa.categoryInstance",
};

const COLUMN_KEYS: Record<string, string> = {
  title: "wa.title",
  parent: "wa.parentWorkspace",
  author: "wa.author",
  updated: "wa.updated",
  description: "wa.description",
  progress: "wa.progress",
  assignees: "wa.assignees",
  template: "wa.template",
};

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) {
    return value.join(", ") || "—";
  }
  if (key === "updated" && typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toLocaleString();
  }
  return String(value);
}

/**
 * Full-text search over the elements of the current work area with a
 * Lucene/Solr-like query language. Results are grouped by category
 * (work spaces, work containers, work instances); the extra table columns
 * are configured by the administrator in the Configuration area.
 */
const WorkAreaSearch = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [columns, setColumns] = useState<Record<string, string[]>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const runSearch = useCallback(
    async (value: string) => {
      if (!projectId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api<{
          total: number;
          groups: SearchGroup[];
          columns: Record<string, string[]>;
        }>(SEARCH_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "search",
            query: value,
            projectId: Number(projectId),
          }),
        });
        setGroups(data.groups ?? []);
        setColumns(data.columns ?? {});
        setTotal(data.total ?? 0);
      } catch (err) {
        const key = err instanceof ApiError ? err.serverKey : null;
        if (key === "search.error.invalidQuery") {
          setError(t(key, err.serverParams ?? undefined));
          setGroups([]);
          setTotal(0);
        } else {
          setError(translate(err));
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId]
  );

  useEffect(() => {
    if (status === "authenticated") {
      void runSearch("");
    }
  }, [status, runSearch]);

  if (status === "unauthenticated") return null;

  const base = `/work-area/${projectId}`;

  const goToRow = (category: string, row: SearchRow) => {
    if (category === "workcontainer") {
      navigate(`${base}/work-containers/${row.dbId}`);
    } else if (category === "workinstance") {
      navigate(`${base}/work-instances/${row.dbId}`);
    } else {
      navigate(`${base}/workspaces`);
    }
  };

  return (
    <>
      <BackLink
        to={base}
        label={`${t("workArea.title")} — ${t("wa.search")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-5xl">
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
            {t("wa.search")}
          </h1>

          <form
            className="mb-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query);
            }}
          >
            <div className="min-w-64 flex-1">
              <label htmlFor="search-query" className="sr-only">
                {t("wa.searchPlaceholder")}
              </label>
              <Input
                id="search-query"
                name="searchQuery"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("wa.searchPlaceholder")}
              />
            </div>
            <Button type="submit" disabled={loading} aria-busy={loading}>
              {t("wa.searchButton")}
            </Button>
          </form>
          <p className="mb-6 text-xs text-muted-foreground">
            {t("wa.searchSyntax")}
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : total === 0 && !error ? (
            <p className="text-sm text-muted-foreground">{t("wa.searchEmpty")}</p>
          ) : (
            <div className="space-y-8">
              {groups.map((group) =>
                group.count === 0 ? null : (
                  <section key={group.category} aria-label={group.category}>
                    <h2 className="mb-2 text-lg font-semibold text-foreground">
                      {t(CATEGORY_KEYS[group.category] ?? "wa.search")}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        ({group.count})
                      </span>
                    </h2>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2">{t("wa.name")}</th>
                            <th className="px-3 py-2">{t("wa.title")}</th>
                            {(columns[group.category] ?? []).map((key) => (
                              <th key={key} className="px-3 py-2">
                                {t(COLUMN_KEYS[key] ?? key)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => (
                            <tr
                              key={row.id}
                              className="border-b last:border-0 hover:bg-muted/30"
                            >
                              <td className="px-3 py-2 font-medium text-foreground">
                                <button
                                  type="button"
                                  className="text-left hover:underline"
                                  onClick={() => goToRow(group.category, row)}
                                >
                                  {row.name}
                                </button>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {row.title || "—"}
                              </td>
                              {(columns[group.category] ?? []).map((key) => (
                                <td
                                  key={key}
                                  className="px-3 py-2 text-muted-foreground"
                                >
                                  {formatCell(key, row.cells[key])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaSearch;
