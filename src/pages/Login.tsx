import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

type Step = "credentials" | "otp";

const labelClass = "block text-sm font-medium leading-none text-foreground mb-1";
const fieldErrorClass = "mt-1 text-sm text-destructive";

const Login = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, login, verifyOtp, sessionLostReason } = useAuth();

  // Destination requested before the auth redirect (set by RequireAuth in
  // location.state.from). Always a relative in-app path; when absent the
  // normal home landing applies.
  const from = (location.state as { from?: string } | null)?.from ?? "";
  const destination = from.startsWith("/") ? from : "/";

  const [step, setStep] = useState<Step>("credentials");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [demoOtp, setDemoOtp] = useState<string | undefined>(undefined);
  const [otpEmail, setOtpEmail] = useState<string | undefined>(undefined);
  const [delivery, setDelivery] = useState<string>("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already authenticated (e.g. reloaded on /login): back to the
  // requested route, or home when there is none.
  if (status === "authenticated") {
    return <Navigate to={destination} replace />;
  }

  const showServerError = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      // "wrong credentials" is returned verbatim by the backend and has a
      // matching i18n entry; other server keys (e.g. the OTP email delivery
      // failure) are translated through the catalog.
      if (err.serverKey === "forbidden") return t("access.forbidden");
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await login(loginName.trim(), password);
      setDemoOtp(result.demoOtp);
      setOtpEmail(result.email);
      setDelivery(result.delivery);
      setStep("otp");
    } catch (err) {
      setError(showServerError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(loginName.trim(), otp.trim());
      navigate(destination, { replace: true });
    } catch (err) {
      setError(showServerError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-4xl font-bold tracking-tight text-foreground">
          {t("home.title")}
        </h1>

        {sessionLostReason && (
          <div
            role="status"
            className="mb-4 rounded-md border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/90 dark:text-amber-100"
          >
            {t("auth.sessionLost")}
          </div>
        )}

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {step === "credentials" ? (
            <form onSubmit={handleCredentials} noValidate>
              <h2 className="mb-4 text-lg font-semibold text-foreground">
                {t("auth.signIn")}
              </h2>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="login-name" className={labelClass}>
                    {t("auth.loginName")}
                  </label>
                  <Input
                    id="login-name"
                    name="loginName"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                    placeholder={t("auth.loginNamePlaceholder")}
                    className="w-full"
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className={labelClass}>
                    {t("auth.password")}
                  </label>
                  <Input
                    id="login-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.passwordPlaceholder")}
                    className="w-full"
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="mt-6">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || !loginName.trim() || !password}
                  aria-busy={busy}
                >
                  {t("auth.continue")}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleOtp} noValidate>
              <h2 className="mb-4 text-lg font-semibold text-foreground">
                {t("auth.otpTitle")}
              </h2>

              <p className="mb-4 text-sm text-muted-foreground">
                {delivery === "dev" ? (
                  <>
                    {t("auth.otpSentDev")}{" "}
                    <span className="text-foreground">
                      {otpEmail ?? loginName}
                    </span>
                    {demoOtp && (
                      <>
                        {" "}
                        {t("auth.otpDevCode")}:{" "}
                        <span className="font-mono font-semibold tracking-widest text-foreground">
                          {demoOtp}
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {t("auth.otpSent")}{" "}
                    <span className="text-foreground">
                      {otpEmail ?? loginName}
                    </span>
                  </>
                )}
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="login-otp" className={labelClass}>
                  {t("auth.otpLabel")}
                </label>
                <Input
                  id="login-otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("auth.otpPlaceholder")}
                  className="w-full font-mono text-center text-lg tracking-[0.5em]"
                  disabled={busy}
                />
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStep("credentials");
                    setError(null);
                    setOtp("");
                    setDemoOtp(undefined);
                  }}
                  disabled={busy}
                >
                  {t("auth.back")}
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={busy || otp.length < 6}
                  aria-busy={busy}
                >
                  {t("auth.verify")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
