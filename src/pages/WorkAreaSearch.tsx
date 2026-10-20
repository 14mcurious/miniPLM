import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchRow } from "@/lib/types";

const SEARCH_ENDPOINT = "/api/my/v1/search";
const PAGE_SIZE = 100;

const COLUMN_KEYS: Record<string, string> = {
  id: "wa.searchId",
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
 * Lucene/Solr-like query language. Results are presented in a single
 * unified table (work containers and work instances together; the
 * WI-/WC- identifier distinguishes them), ordered by "updated" in
 * descending order. By default the first 100 matches are shown; a
 * "load more" button fetches the following pages when more matches
 * exist. The columns (default: id, title, progress, updated) are
 * configured by the administrator in the Configuration area.
 */
const WorkAreaSearch = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const fetchPage = useCallback(
    async (value: string, offset: number) => {
      const data = await api<{
        total: number;
        hasMore: boolean;
        columns: string[];
        rows: SearchRow[];
      }>(SEARCH_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "search",
          query: value,
          projectId: Number(projectId),
          offset,
          limit: PAGE_SIZE,
        }),
      });
      return {
        total: data.total ?? 0,
        hasMore: Boolean(data.hasMore),
        columns: data.columns ?? [],
        rows: data.rows ?? [],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId]
  );

  const runSearch = useCallback(
    async (value: string) => {
      if (!projectId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPage(value, 0);
        setRows(data.rows);
        setColumns(data.columns);
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (err) {
        const key = err instanceof ApiError ? err.serverKey : null;
        if (key === "search.error.invalidQuery") {
          setError(t(key, err.serverParams ?? undefined));
          setRows([]);
          setTotal(0);
          setHasMore(false);
        } else {
          setError(translate(err));
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, fetchPage]
  );

  const loadMore = useCallback(async () => {
    if (!projectId || loadingMore) return;
    const offset = rows.length;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchPage(query, offset);
      setRows((prev) => {
        const seen = new Set(prev.map((row) => row.id));
        return [...prev, ...data.rows.filter((row) => !seen.has(row.id))];
      });
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, fetchPage, query, rows.length, loadingMore]);

  useEffect(() => {
    if (status === "authenticated") {
      void runSearch("");
    }
  }, [status, runSearch]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const base = `/work-area/${projectId}`;

  const goToRow = (row: SearchRow) => {
    if (row.category === "workcontainer") {
      navigate(`${base}/work-containers/${row.dbId}`);
    } else {
      navigate(`${base}/work-instances/${row.dbId}`);
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
          ) : rows.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">{t("wa.searchEmpty")}</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {total} {t("wa.resultsFound")}
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      {columns.map((key) => (
                        <th key={key} className="px-3 py-2">
                          {t(COLUMN_KEYS[key] ?? key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        {columns.map((key) => {
                          if (key === "id") {
                            return (
                              <td key={key} className="px-3 py-2">
                                <button
                                  type="button"
                                  className="text-left font-medium text-foreground hover:underline"
                                  title={row.title}
                                  onClick={() => goToRow(row)}
                                >
                                  {row.id}
                                </button>
                              </td>
                            );
                          }
                          if (key === "title") {
                            return (
                              <td
                                key={key}
                                className="px-3 py-2 text-muted-foreground"
                              >
                                {row.title || "—"}
                              </td>
                            );
                          }
                          return (
                            <td
                              key={key}
                              className="px-3 py-2 text-muted-foreground"
                            >
                              {formatCell(key, row.cells[key])}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMore && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingMore}
                    aria-busy={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {t("wa.loadMore")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaSearch;
