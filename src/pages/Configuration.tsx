import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const PROJECTS_ENDPOINT = "/api/my/v1/projects";

const Configuration = () => {
  const { t } = useI18n();

  const [maxSubprojectLevels, setMaxSubprojectLevels] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  // Load the currently configured depth limit.
  useEffect(() => {
    api<{ maxSubprojectLevels: number }>(PROJECTS_ENDPOINT)
      .then((data) => setMaxSubprojectLevels(String(data.maxSubprojectLevels)))
      .catch(() => {
        // leave the field empty; saving will surface the server error
      });
  }, []);

  const validate = (): string | null => {
    const value = Number(maxSubprojectLevels);
    if (!/^\d+$/.test(maxSubprojectLevels.trim()) || value < 1 || value > 1000) {
      return "configuration.error.invalidValue";
    }
    return null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const error = validate();
    setFieldError(error);
    setBannerError(null);
    if (error) return;

    setSaving(true);
    try {
      await api(PROJECTS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update-settings",
          maxSubprojectLevels: Number(maxSubprojectLevels),
        }),
      });
      toast.success(t("configuration.saved"));
    } catch (err) {
      if (err instanceof ApiError && err.serverKey) {
        setBannerError({
          key: err.serverKey,
          params: err.serverParams ?? undefined,
        });
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

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-32";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <BackLink to="/administration" label={t("administration.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            {t("configuration.title")}
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {t("configuration.description")}
          </p>

          {bannerError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t(bannerError.key, bannerError.params)}
            </div>
          )}

          <form onSubmit={handleSave} noValidate className="space-y-4">
            <div>
              <label htmlFor="max-subproject-levels" className={labelClass}>
                {t("configuration.maxSubprojectLevels")}
              </label>
              <Input
                id="max-subproject-levels"
                name="maxSubprojectLevels"
                type="number"
                min={1}
                max={1000}
                value={maxSubprojectLevels}
                onChange={(e) => {
                  setMaxSubprojectLevels(e.target.value);
                  setFieldError(null);
                }}
                disabled={saving}
                className={fieldClass}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("configuration.maxSubprojectLevelsHint")}
              </p>
              {fieldError && (
                <p className={fieldErrorClass}>{t(fieldError)}</p>
              )}
            </div>

            <div className="border-t pt-4">
              <Button type="submit" disabled={saving} aria-busy={saving}>
                {t("configuration.save")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default Configuration;
