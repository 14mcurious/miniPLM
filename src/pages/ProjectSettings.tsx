import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const PROJECTS_ENDPOINT = "/api/my/v1/projects";

/**
 * Separate page for the project settings (maximum sub-project levels).
 * Reached from the main Configuration page via a dedicated button so the
 * project settings form no longer crowds the general settings page.
 */
const ProjectSettings = () => {
  const { t } = useI18n();

  const [maxSubprojectLevels, setMaxSubprojectLevels] = useState<string>("");
  const [savingDepth, setSavingDepth] = useState(false);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  const translate = (err: unknown, fallbackStatus = "?"): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: fallbackStatus });
  };

  // Load the currently configured value.
  useEffect(() => {
    api<{ maxSubprojectLevels: number }>(PROJECTS_ENDPOINT)
      .then((data) => setMaxSubprojectLevels(String(data.maxSubprojectLevels)))
      .catch(() => {
        // leave the field empty; saving will surface the server error
      });
  }, []);

  const validateDepth = (): string | null => {
    const value = Number(maxSubprojectLevels);
    if (!/^\d+$/.test(maxSubprojectLevels.trim()) || value < 1 || value > 1000) {
      return "configuration.error.invalidValue";
    }
    return null;
  };

  const handleSaveDepth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingDepth) return;
    const error = validateDepth();
    setDepthError(error);
    setBannerError(null);
    if (error) return;

    setSavingDepth(true);
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
      setBannerError(
        err instanceof ApiError && err.serverKey
          ? { key: err.serverKey, params: err.serverParams ?? undefined }
          : { key: "error.requestFailed", params: { status: "?" } }
      );
      toast.error(translate(err));
    } finally {
      setSavingDepth(false);
    }
  };

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-32";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <BackLink
        to="/administration/configuration"
        label={t("configuration.title")}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl space-y-6">
          <div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
              {t("projectSettings.title")}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("projectSettings.description")}
            </p>
          </div>

          {bannerError && (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t(bannerError.key, bannerError.params)}
            </div>
          )}

          <form
            onSubmit={handleSaveDepth}
            noValidate
            className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
          >
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
                  setDepthError(null);
                }}
                disabled={savingDepth}
                className={fieldClass}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("configuration.maxSubprojectLevelsHint")}
              </p>
              {depthError && (
                <p className={fieldErrorClass}>{t(depthError)}</p>
              )}
            </div>
            <div className="border-t pt-4">
              <Button
                type="submit"
                disabled={savingDepth}
                aria-busy={savingDepth}
              >
                {t("configuration.save")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default ProjectSettings;
