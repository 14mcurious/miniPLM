import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

const SEARCH_ENDPOINT = "/api/my/v1/search";

const CATEGORY_KEYS: Record<string, string> = {
  workcontainer: "wa.categoryContainer",
  workinstance: "wa.categoryInstance",
};

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

/**
 * Administrator configuration of the columns shown in the search results
 * tables (per category). The default set is id, title, progress, updated.
 */
const SearchColumnsSection = () => {
  const { t } = useI18n();
  const [columns, setColumns] = useState<Record<string, string[]>>({});
  const [allowed, setAllowed] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    try {
      const data = await api<{
        columns: Record<string, string[]>;
        allowed: Record<string, string[]>;
      }>(SEARCH_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "get-columns" }),
      });
      setColumns(data.columns ?? {});
      setAllowed(data.allowed ?? {});
    } catch (err) {
      setError(translate(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (category: string, key: string) => {
    setColumns((prev) => {
      const current = prev[category] ?? [];
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      return { ...prev, [category]: next };
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ columns: Record<string, string[]> }>(
        SEARCH_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "update-columns",
            columns,
          }),
        }
      );
      setColumns(data.columns ?? columns);
      toast.success(t("configuration.saved"));
    } catch (err) {
      setError(translate(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
    >
      <h2 className="text-xl font-semibold text-foreground">
        {t("sc.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("sc.hint")}</p>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {(["workcontainer", "workinstance"] as const).map(
        (category) => (
          <div key={category} className="rounded-md border p-3">
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {t(CATEGORY_KEYS[category])}
            </h3>
            <div className="flex flex-wrap gap-4">
              {(allowed[category] ?? []).map((key) => {
                const checked = (columns[category] ?? []).includes(key);
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      id={`search-col-${category}-${key}`}
                      name={`searchCol${category}${key}`}
                      checked={checked}
                      onChange={() => toggle(category, key)}
                      disabled={busy}
                      className="h-4 w-4 rounded border-input"
                    />
                    <span>{t(COLUMN_KEYS[key] ?? key)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )
      )}

      <div className="border-t pt-4">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {t("configuration.save")}
        </Button>
      </div>
    </form>
  );
};

export default SearchColumnsSection;
