import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const AUTH_ENDPOINT = "/api/my/v1/auth";

interface SecuritySettingsPayload {
  sessionDurationHours: number;
  sessionWarningMinutes: number;
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  loginNameAlnumOnly: boolean;
  loginNameMinLength: number;
  loginNameMaxLength: number;
}

const PASSWORD_LENGTH_MIN = 1;
const PASSWORD_LENGTH_MAX = 64;
const LOGIN_LENGTH_MIN = 1;
const LOGIN_LENGTH_MAX = 64;

type Banner = {
  key: string;
  params?: Record<string, string | number>;
} | null;

/**
 * Page for all security policies managed by the administrator: session
 * duration / extension prompt, the password policy (minimum length and
 * complexity rules) and the login name policy (allowed characters and
 * length). Reached from the main Configuration page via a dedicated button.
 */
const SecuritySettings = () => {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);

  // Session policy.
  const [sessionHours, setSessionHours] = useState<string>("");
  const [sessionWarning, setSessionWarning] = useState<string>("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionBanner, setSessionBanner] = useState<Banner>(null);

  // Password policy.
  const [passwordMinLength, setPasswordMinLength] = useState<string>("");
  const [requireUppercase, setRequireUppercase] = useState(false);
  const [requireLowercase, setRequireLowercase] = useState(false);
  const [requireDigit, setRequireDigit] = useState(false);
  const [requireSpecial, setRequireSpecial] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBanner, setPasswordBanner] = useState<Banner>(null);

  // Login name policy.
  const [loginAlnumOnly, setLoginAlnumOnly] = useState(false);
  const [loginMinLength, setLoginMinLength] = useState<string>("");
  const [loginMaxLength, setLoginMaxLength] = useState<string>("");
  const [savingLogin, setSavingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBanner, setLoginBanner] = useState<Banner>(null);

  const translate = (err: unknown, fallbackStatus = "?"): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: fallbackStatus });
  };

  const bannerFromError = (err: unknown): Banner =>
    err instanceof ApiError && err.serverKey
      ? { key: err.serverKey, params: err.serverParams ?? undefined }
      : { key: "error.requestFailed", params: { status: "?" } };

  // Load all the currently configured security policies.
  useEffect(() => {
    api<SecuritySettingsPayload>(AUTH_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "get-settings" }),
    })
      .then((data) => {
        setSessionHours(String(data.sessionDurationHours));
        setSessionWarning(String(data.sessionWarningMinutes));
        setPasswordMinLength(String(data.minPasswordLength));
        setRequireUppercase(data.requireUppercase);
        setRequireLowercase(data.requireLowercase);
        setRequireDigit(data.requireDigit);
        setRequireSpecial(data.requireSpecial);
        setLoginAlnumOnly(data.loginNameAlnumOnly);
        setLoginMinLength(String(data.loginNameMinLength));
        setLoginMaxLength(String(data.loginNameMaxLength));
      })
      .catch(() => {
        // leave the fields empty; saving will surface the server error
      })
      .finally(() => setLoading(false));
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
    setSessionBanner(null);
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
      setSessionBanner(bannerFromError(err));
      toast.error(translate(err));
    } finally {
      setSavingSession(false);
    }
  };

  const validatePasswordPolicy = (): string | null => {
    const min = Number(passwordMinLength);
    if (
      !/^\d+$/.test(passwordMinLength.trim()) ||
      min < PASSWORD_LENGTH_MIN ||
      min > PASSWORD_LENGTH_MAX
    ) {
      return "auth.error.invalidPasswordPolicy";
    }
    return null;
  };

  const handleSavePasswordPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPassword) return;
    const error = validatePasswordPolicy();
    setPasswordError(error);
    setPasswordBanner(null);
    if (error) return;

    setSavingPassword(true);
    try {
      await api(AUTH_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update-password-policy",
          minPasswordLength: Number(passwordMinLength),
          requireUppercase,
          requireLowercase,
          requireDigit,
          requireSpecial,
        }),
      });
      toast.success(t("configuration.saved"));
    } catch (err) {
      setPasswordBanner(bannerFromError(err));
      toast.error(translate(err));
    } finally {
      setSavingPassword(false);
    }
  };

  const validateLoginPolicy = (): string | null => {
    const min = Number(loginMinLength);
    const max = Number(loginMaxLength);
    if (
      !/^\d+$/.test(loginMinLength.trim()) ||
      !/^\d+$/.test(loginMaxLength.trim()) ||
      min < LOGIN_LENGTH_MIN ||
      min > LOGIN_LENGTH_MAX ||
      max < LOGIN_LENGTH_MIN ||
      max > LOGIN_LENGTH_MAX ||
      max < min
    ) {
      return "auth.error.invalidLoginPolicy";
    }
    return null;
  };

  const handleSaveLoginPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingLogin) return;
    const error = validateLoginPolicy();
    setLoginError(error);
    setLoginBanner(null);
    if (error) return;

    setSavingLogin(true);
    try {
      await api(AUTH_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "update-login-policy",
          loginNameAlnumOnly: loginAlnumOnly,
          loginNameMinLength: Number(loginMinLength),
          loginNameMaxLength: Number(loginMaxLength),
        }),
      });
      toast.success(t("configuration.saved"));
    } catch (err) {
      setLoginBanner(bannerFromError(err));
      toast.error(translate(err));
    } finally {
      setSavingLogin(false);
    }
  };

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-32";
  const fieldErrorClass = "mt-1 text-sm text-destructive";
  const hintClass = "mt-1 text-xs text-muted-foreground";
  const checkboxClass = "h-4 w-4 rounded border-input accent-primary";
  const checkboxLabelClass = "text-sm text-foreground";

  const renderBanner = (banner: Banner) =>
    banner ? (
      <div
        role="alert"
        className="mb-3 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {t(banner.key, banner.params)}
      </div>
    ) : null;

  if (loading) {
    return (
      <>
        <BackLink
          to="/administration/configuration"
          label={t("configuration.title")}
        />
        <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
          <div className="w-full max-w-xl">
            <p className="text-sm text-muted-foreground">
              {t("usersList.loading")}
            </p>
          </div>
        </div>
      </>
    );
  }

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

          {/* Session policy */}
          <form
            onSubmit={handleSaveSession}
            noValidate
            className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
          >
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {t("securitySettings.sessionTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("securitySettings.sessionDescription")}
              </p>
            </div>
            {renderBanner(sessionBanner)}
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
                <p className={hintClass}>
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
                <p className={hintClass}>
                  {t("configuration.sessionWarningMinutesHint")}
                </p>
              </div>
            </div>
            {sessionError && <p className={fieldErrorClass}>{t(sessionError)}</p>}
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

          {/* Password policy */}
          <form
            onSubmit={handleSavePasswordPolicy}
            noValidate
            className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
          >
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {t("securitySettings.passwordPolicyTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("securitySettings.passwordPolicyDescription")}
              </p>
            </div>
            {renderBanner(passwordBanner)}
            <div>
              <label htmlFor="password-min-length" className={labelClass}>
                {t("securitySettings.passwordMinLength")}
              </label>
              <Input
                id="password-min-length"
                name="passwordMinLength"
                type="number"
                min={PASSWORD_LENGTH_MIN}
                max={PASSWORD_LENGTH_MAX}
                value={passwordMinLength}
                onChange={(e) => {
                  setPasswordMinLength(e.target.value);
                  setPasswordError(null);
                }}
                disabled={savingPassword}
                className={fieldClass}
              />
              <p className={hintClass}>
                {t("securitySettings.passwordMinLengthHint")}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="password-require-uppercase"
                  name="requireUppercase"
                  type="checkbox"
                  checked={requireUppercase}
                  onChange={(e) => setRequireUppercase(e.target.checked)}
                  disabled={savingPassword}
                  className={checkboxClass}
                />
                <label htmlFor="password-require-uppercase" className={checkboxLabelClass}>
                  {t("securitySettings.passwordRequireUppercase")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="password-require-lowercase"
                  name="requireLowercase"
                  type="checkbox"
                  checked={requireLowercase}
                  onChange={(e) => setRequireLowercase(e.target.checked)}
                  disabled={savingPassword}
                  className={checkboxClass}
                />
                <label htmlFor="password-require-lowercase" className={checkboxLabelClass}>
                  {t("securitySettings.passwordRequireLowercase")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="password-require-digit"
                  name="requireDigit"
                  type="checkbox"
                  checked={requireDigit}
                  onChange={(e) => setRequireDigit(e.target.checked)}
                  disabled={savingPassword}
                  className={checkboxClass}
                />
                <label htmlFor="password-require-digit" className={checkboxLabelClass}>
                  {t("securitySettings.passwordRequireDigit")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="password-require-special"
                  name="requireSpecial"
                  type="checkbox"
                  checked={requireSpecial}
                  onChange={(e) => setRequireSpecial(e.target.checked)}
                  disabled={savingPassword}
                  className={checkboxClass}
                />
                <label htmlFor="password-require-special" className={checkboxLabelClass}>
                  {t("securitySettings.passwordRequireSpecial")}
                </label>
              </div>
            </div>
            {passwordError && (
              <p className={fieldErrorClass}>{t(passwordError)}</p>
            )}
            <div className="border-t pt-4">
              <Button
                type="submit"
                disabled={savingPassword}
                aria-busy={savingPassword}
              >
                {t("configuration.save")}
              </Button>
            </div>
          </form>

          {/* Login name policy */}
          <form
            onSubmit={handleSaveLoginPolicy}
            noValidate
            className="space-y-4 rounded-lg border bg-card p-5 shadow-sm"
          >
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {t("securitySettings.loginNamePolicyTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("securitySettings.loginNamePolicyDescription")}
              </p>
            </div>
            {renderBanner(loginBanner)}
            <div className="flex items-center gap-2">
              <input
                id="login-name-alnum-only"
                name="loginNameAlnumOnly"
                type="checkbox"
                checked={loginAlnumOnly}
                onChange={(e) => setLoginAlnumOnly(e.target.checked)}
                disabled={savingLogin}
                className={checkboxClass}
              />
              <label htmlFor="login-name-alnum-only" className={checkboxLabelClass}>
                {t("securitySettings.loginNameAlnumOnly")}
              </label>
            </div>
            <p className={hintClass}>{t("securitySettings.loginNameAlnumOnlyHint")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="login-name-min-length" className={labelClass}>
                  {t("securitySettings.loginNameMinLength")}
                </label>
                <Input
                  id="login-name-min-length"
                  name="loginNameMinLength"
                  type="number"
                  min={LOGIN_LENGTH_MIN}
                  max={LOGIN_LENGTH_MAX}
                  value={loginMinLength}
                  onChange={(e) => {
                    setLoginMinLength(e.target.value);
                    setLoginError(null);
                  }}
                  disabled={savingLogin}
                  className={fieldClass}
                />
                <p className={hintClass}>
                  {t("securitySettings.loginNameMinLengthHint")}
                </p>
              </div>
              <div>
                <label htmlFor="login-name-max-length" className={labelClass}>
                  {t("securitySettings.loginNameMaxLength")}
                </label>
                <Input
                  id="login-name-max-length"
                  name="loginNameMaxLength"
                  type="number"
                  min={LOGIN_LENGTH_MIN}
                  max={LOGIN_LENGTH_MAX}
                  value={loginMaxLength}
                  onChange={(e) => {
                    setLoginMaxLength(e.target.value);
                    setLoginError(null);
                  }}
                  disabled={savingLogin}
                  className={fieldClass}
                />
                <p className={hintClass}>
                  {t("securitySettings.loginNameMaxLengthHint")}
                </p>
              </div>
            </div>
            {loginError && <p className={fieldErrorClass}>{t(loginError)}</p>}
            <div className="border-t pt-4">
              <Button
                type="submit"
                disabled={savingLogin}
                aria-busy={savingLogin}
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
