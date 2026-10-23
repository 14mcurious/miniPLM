import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import OtpStep from "@/components/OtpStep";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import {
  DEFAULT_SECURITY_POLICY,
  normalizeSecurityPolicy,
  passwordErrorKey,
  policyErrorParams,
  type SecurityPolicy,
} from "@/lib/security-policy";

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

interface UserDetails {
  id: number;
  loginName: string;
  email: string;
  name: string;
  surname: string;
  company: string | null;
  notifyEmail: boolean;
  isDisabled: boolean;
  groups: UserGroup[];
  projects: ProjectRef[];
  roles: ProjectRef[];
}

const UserEdit = () => {
  const { t } = useI18n();
  const { userId } = useParams<{ userId: string }>();

  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy>(
    DEFAULT_SECURITY_POLICY
  );

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordVerify, setNewPasswordVerify] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>(
    {}
  );
  const [pwOtpStep, setPwOtpStep] = useState<"form" | "otp">("form");
  const [pwDelivery, setPwDelivery] = useState("email");
  const [pwDemoOtp, setPwDemoOtp] = useState<string | undefined>(undefined);
  const [pwSentTo, setPwSentTo] = useState("");
  const [pwOtpError, setPwOtpError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const data = await api<{ user: UserDetails }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "get", id: Number(userId) }),
      });
      setUser(data.user);
    } catch (err) {
      if (err instanceof ApiError && err.serverKey === "users.error.userNotFound") {
        setNotFound(true);
      } else {
        const message =
          err instanceof ApiError && err.serverKey
            ? t(err.serverKey, err.serverParams ?? undefined)
            : t("error.requestFailed", { status: "?" });
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Load the configurable security policy for client-side password
    // validation; fall back to the defaults when the endpoint fails.
    api<Partial<SecurityPolicy>>(USERS_ENDPOINT)
      .then((data) => setPolicy(normalizeSecurityPolicy(data)))
      .catch(() => {
        // keep the default policy
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleToggleDisabled = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const data = await api<{ user: UserDetails }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: user.isDisabled ? "enable" : "disable",
          id: user.id,
        }),
      });
      setUser(data.user);
      toast.success(t("userEdit.updated"));
    } catch (error) {
      const message =
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const closeChangePassword = () => {
    setShowChangePassword(false);
    setNewPassword("");
    setNewPasswordVerify("");
    setPasswordErrors({});
    setPwOtpStep("form");
    setPwDemoOtp(undefined);
    setPwOtpError(null);
  };

  const handleConfirmChangePassword = async () => {
    if (!user || busy) return;
    const errors: Record<string, string> = {};
    const pwError = passwordErrorKey(newPassword, policy);
    if (pwError) {
      errors.newPassword = pwError;
    }
    if (!newPasswordVerify) {
      errors.newPasswordVerify = "users.error.verifyRequired";
    } else if (newPasswordVerify !== newPassword) {
      errors.newPasswordVerify = "users.error.verifyMismatch";
    }
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setPwOtpError(null);
    try {
      // Stage the change and email the one-time code to the user's
      // CURRENT mailbox; the password is applied only after the code.
      const data = await api<{ delivery: string; demoOtp?: string; email?: string }>(
        USERS_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "change-password",
            id: user.id,
            password: newPassword,
          }),
        }
      );
      setPwDelivery(data.delivery);
      setPwDemoOtp(data.demoOtp);
      setPwSentTo(data.email || user.email);
      setPwOtpStep("otp");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.serverKey &&
        error.serverKey.startsWith("users.error.password")
      ) {
        setPasswordErrors({ newPassword: error.serverKey });
      }
      toast.error(
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPasswordOtp = async (otp: string) => {
    if (!user || busy) return;
    setBusy(true);
    setPwOtpError(null);
    try {
      const data = await api<{ user: UserDetails }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "confirm-change-password",
          id: user.id,
          otp,
          password: newPassword,
        }),
      });
      setUser(data.user);
      toast.success(t("newUser.passwordChanged"));
      closeChangePassword();
    } catch (error) {
      setPwOtpError(
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setBusy(false);
    }
  };

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-full";
  const fieldErrorClass = "mt-1 text-sm text-destructive";
  const renderPasswordError = (key: string | null) =>
    key ? t(key, policyErrorParams(key, policy)) : null;

  return (
    <>
      <BackLink
        to="/administration/users/users-list"
        label={t("usersList.title")}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            {t("userEdit.title")}
          </h1>
          {!loading && user && (
            <p className="mb-6 text-sm text-muted-foreground">
              {t("newUser.loginName")}:{" "}
              <span className="font-medium">{user.loginName}</span>
              {" · "}
              {t("userEdit.statusPrefix")}:{" "}
              {user.isDisabled
                ? t("newUser.statusDisabled")
                : t("newUser.statusEnabled")}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("usersList.loading")}
            </p>
          ) : notFound || !user ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("users.error.userNotFound")}
            </div>
          ) : (
            <>
              <dl className="space-y-3 rounded-md border p-4 text-sm">
                <div>
                  <dt className={labelClass}>{t("newUser.loginName")}</dt>
                  <dd className="text-foreground">{user.loginName}</dd>
                </div>
                <div>
                  <dt className={labelClass}>{t("newUser.email")}</dt>
                  <dd className="text-foreground">{user.email}</dd>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className={labelClass}>{t("newUser.name")}</dt>
                    <dd className="text-foreground">{user.name}</dd>
                  </div>
                  <div>
                    <dt className={labelClass}>{t("newUser.surname")}</dt>
                    <dd className="text-foreground">{user.surname}</dd>
                  </div>
                </div>
                <div>
                  <dt className={labelClass}>{t("newUser.company")}</dt>
                  <dd className="text-foreground">
                    {user.company || t("usersList.none")}
                  </dd>
                </div>
                <div>
                  <dt className={labelClass}>{t("newUser.notifyEmail")}</dt>
                  <dd className="text-foreground">
                    {user.notifyEmail ? t("userEdit.yes") : t("userEdit.no")}
                  </dd>
                </div>
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  {t("newUser.immutableNote")}
                </p>
              </dl>

              <div className="mt-4">
                <span className={labelClass}>{t("newUser.groups")}</span>
                <div className="min-h-[3rem] rounded-md border border-input bg-muted/30 p-3">
                  {user.groups.length > 0 ? (
                    <ul className="space-y-3">
                      {user.groups.map((group) => (
                        <li key={group.id} className="text-sm">
                          <div className="font-medium text-foreground">
                            <Link
                              to={`/administration/groups/group-edit/${group.id}`}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              {group.name}
                            </Link>{" "}
                            <span className="font-normal text-muted-foreground">
                              — {t("newUser.groupAccessMode")}: {group.accessMode}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            {t("newUser.groupProjects")}:{" "}
                            {group.projects.length > 0
                              ? group.projects.map((p) => (
                                  <span key={p.id} className="mr-1 inline-block">
                                    <Link
                                      to={`/administration/projects/project-edit/${p.id}`}
                                      className="text-primary underline-offset-2 hover:underline"
                                    >
                                      {p.name}
                                    </Link>
                                  </span>
                                ))
                              : "—"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("usersList.none")}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <span className={labelClass}>{t("usersList.roles")}</span>
                <div className="min-h-[3rem] rounded-md border border-input bg-muted/30 p-3">
                  {user.roles.length > 0 ? (
                    <ul className="flex flex-wrap gap-2">
                      {user.roles.map((role) => (
                        <li
                          key={role.id}
                          className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                        >
                          {role.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("usersList.none")}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={handleToggleDisabled}
                >
                  {user.isDisabled
                    ? t("newUser.enable")
                    : t("newUser.disable")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setShowChangePassword((v) => !v)}
                >
                  {t("newUser.changePassword")}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link to="/administration/users/users-list">
                    {t("userEdit.backToUsersList")}
                  </Link>
                </Button>
              </div>

              {showChangePassword && pwOtpStep === "form" && (
                <div className="mt-6 rounded-md border p-4">
                  <h2 className="mb-3 text-lg font-semibold text-foreground">
                    {t("newUser.changePassword")}
                  </h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {t("userEdit.passwordOtpNote")}
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="user-new-password" className={labelClass}>
                        {t("newUser.newPassword")} *
                      </label>
                      <Input
                        id="user-new-password"
                        name="newPassword"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={busy}
                        className={fieldClass}
                      />
                      {renderPasswordError(passwordErrors.newPassword) && (
                        <p className={fieldErrorClass}>
                          {t(passwordErrors.newPassword)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor="user-new-password-verify"
                        className={labelClass}
                      >
                        {t("newUser.verifyPassword")} *
                      </label>
                      <Input
                        id="user-new-password-verify"
                        name="newPasswordVerify"
                        type="password"
                        value={newPasswordVerify}
                        onChange={(e) => setNewPasswordVerify(e.target.value)}
                        disabled={busy}
                        className={fieldClass}
                      />
                      {renderPasswordError(
                        passwordErrors.newPasswordVerify
                      ) && (
                        <p className={fieldErrorClass}>
                          {t(passwordErrors.newPasswordVerify)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={handleConfirmChangePassword}
                      >
                        {t("newUser.confirm")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={closeChangePassword}
                      >
                        {t("newUser.cancel")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {showChangePassword && pwOtpStep === "otp" && (
                <div className="mt-6 rounded-md border p-4">
                  <h2 className="mb-3 text-lg font-semibold text-foreground">
                    {t("userEdit.passwordOtpTitle")}
                  </h2>
                  <OtpStep
                    info={t("userEdit.otpSentToUser", { email: pwSentTo || user.email })}
                    delivery={pwDelivery}
                    demoOtp={pwDemoOtp}
                    error={pwOtpError}
                    confirmLabel={t("userEdit.confirmOtp")}
                    onConfirm={handleConfirmPasswordOtp}
                    onCancel={() => setPwOtpStep("form")}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default UserEdit;
