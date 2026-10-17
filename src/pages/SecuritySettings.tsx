import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const AUTH_ENDPOINT = "/api/my/v1/auth";

/**
 * Separate page for the session/security settings (session duration and
 * extension prompt). Reached from the main Configuration page via a
 * dedicated button so the session form no longer crowds the general
 * settings page.
 */
const SecuritySettings = () => {
  const { t } = useI18n();

  const [sessionHours, setSessionHours] = useState<string>("");
  const [sessionWarning, setSessionWarning] = useState<string>("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
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

  // Load the currently configured session policies.
  useEffect(() => {
    api<{ sessionDurationHours: number; sessionWarningMinutes: number }>(
      AUTH_ENDPOINT,
      { method: "POST", body: JSON.stringify({ operation: "get-settings" }) }
    )
      .then((data) => {
        setSessionHours(String(data.sessionDurationHours));
        setSessionWarning(String(data.sessionWarningMinutes));
      })
      .catch(() => {
        // leave the fields empty; saving will surface the server error
      });
  }, []);

  const validateSession = (): string | null => {
    const hours = Number(sessionHours);
    const warning = Number(sessionWarning);
    if (
      !/^\d+$/.test(sessionHours.trim()) ||
      !/^\d+$/.test(sessionWarning.trim()) ||
      hours < 1 ||
      hours > 48 ||
      warning < 1 ||
      warning >= hours * 60
    ) {
      return "auth.error.invalidValue";
    }
    return null;
  };

  const handleSaveSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSession) return;
    const error = validateSession();
    setSessionError(error);
    setBannerError(null);
    if (error) return;

    setSavingSession(true);
    try {
      await api(AUTH_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update-session-settings",
          sessionDurationHours: Number(sessionHours),
          sessionWarningMinutes: Number(sessionWarning),
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
      setSavingSession(false);
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
              {t("securitySettings.title")}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("securitySettings.description")}
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
            onSubmit={handleSaveSession}
            noValidate
            className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="session-hours" className={labelClass}>
                  {t("configuration.sessionDurationHours")}
                </label>
                <Input
                  id="session-hours"
                  name="sessionDurationHours"
                  type="number"
                  min={1}
                  max={48}
                  value={sessionHours}
                  onChange={(e) => {
                    setSessionHours(e.target.value);
                    setSessionError(null);
                  }}
                  disabled={savingSession}
                  className={fieldClass}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("configuration.sessionDurationHoursHint")}
                </p>
              </div>
              <div>
                <label htmlFor="session-warning" className={labelClass}>
                  {t("configuration.sessionWarningMinutes")}
                </label>
                <Input
                  id="session-warning"
                  name="sessionWarningMinutes"
                  type="number"
                  min={1}
                  max={2880}
                  value={sessionWarning}
                  onChange={(e) => {
                    setSessionWarning(e.target.value);
                    setSessionError(null);
                  }}
                  disabled={savingSession}
                  className={fieldClass}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("configuration.sessionWarningMinutesHint")}
                </p>
              </div>
            </div>
            {sessionError && (
              <p className={fieldErrorClass}>{t(sessionError)}</p>
            )}
            <div className="border-t pt-4">
              <Button
                type="submit"
                disabled={savingSession}
                aria-busy={savingSession}
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

export default SecuritySettings;
