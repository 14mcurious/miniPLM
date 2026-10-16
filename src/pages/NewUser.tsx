import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

const USERS_ENDPOINT = "/api/my/v1/users";
const DEFAULT_MIN_PASSWORD_LENGTH = 12;
const LOGIN_NAME_RE = /^[A-Za-z0-9]+$/;
const SPECIAL_CHAR_RE = /[^A-Za-z0-9]/;

interface GroupInfo {
  name: string;
  projects: string[];
  accessMode: string;
}

interface SavedUser {
  id: number;
  loginName: string;
  email: string;
  name: string;
  surname: string;
  company: string | null;
  notifyEmail: boolean;
  isDisabled: boolean;
  groups: GroupInfo[];
}

/** Client-side mirror of the server password policy; returns an i18n key. */
function passwordErrorKey(password: string, minLength: number): string | null {
  if (!password) return "users.error.passwordRequired";
  if (password.length < minLength) return "users.error.passwordTooShort";
  if (!SPECIAL_CHAR_RE.test(password)) return "users.error.passwordSpecial";
  if (!/\d/.test(password)) return "users.error.passwordDigit";
  if (!/[A-Z]/.test(password)) return "users.error.passwordUppercase";
  if (!/[a-z]/.test(password)) return "users.error.passwordLowercase";
  return null;
}

const NewUser = () => {
  const { t } = useI18n();

  const [minPasswordLength, setMinPasswordLength] = useState(
    DEFAULT_MIN_PASSWORD_LENGTH
  );
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [company, setCompany] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(false);

  const [savedUser, setSavedUser] = useState<SavedUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordVerify, setNewPasswordVerify] = useState("");
  const [changePasswordErrors, setChangePasswordErrors] = useState<
    Record<string, string>
  >({});

  // Load the configurable password policy from the backend.
  useEffect(() => {
    api<{ minPasswordLength: number }>(USERS_ENDPOINT)
      .then((data) => setMinPasswordLength(data.minPasswordLength))
      .catch(() => {
        // keep the default policy when the endpoint is unreachable
      });
  }, []);

  const renderError = (key: string | null) =>
    key ? t(key, { min: minPasswordLength }) : null;

  const validateCreate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!loginName.trim()) {
      errors.loginName = "users.error.loginNameRequired";
    } else if (!LOGIN_NAME_RE.test(loginName.trim())) {
      errors.loginName = "users.error.loginNameFormat";
    }
    const pwError = passwordErrorKey(password, minPasswordLength);
    if (pwError) errors.password = pwError;
    if (!verifyPassword) {
      errors.verifyPassword = "users.error.verifyRequired";
    } else if (verifyPassword !== password) {
      errors.verifyPassword = "users.error.verifyMismatch";
    }
    if (!email.trim()) errors.email = "users.error.emailRequired";
    if (!name.trim()) errors.name = "users.error.nameRequired";
    if (!surname.trim()) errors.surname = "users.error.surnameRequired";
    return errors;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || savedUser) return;
    const errors = validateCreate();
    setFieldErrors(errors);
    setBannerError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const data = await api<{ user: SavedUser }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          loginName: loginName.trim(),
          password,
          verifyPassword,
          email: email.trim(),
          name: name.trim(),
          surname: surname.trim(),
          company: company.trim(),
          notifyEmail,
        }),
      });
      setSavedUser(data.user);
      toast.success(t("newUser.saved"));
    } catch (error) {
      if (error instanceof ApiError && error.serverKey) {
        setBannerError({ key: error.serverKey, params: error.serverParams ?? undefined });
      } else {
        setBannerError({ key: "error.requestFailed", params: { status: "?" } });
      }
      toast.error(
        error instanceof ApiError && error.serverKey
          ? t(error.serverKey, error.serverParams ?? undefined)
          : t("error.requestFailed", { status: "?" })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async () => {
    if (!savedUser || busy) return;
    setBusy(true);
    setBannerError(null);
    try {
      const data = await api<{ user: SavedUser }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: savedUser.isDisabled ? "enable" : "disable",
          id: savedUser.id,
        }),
      });
      setSavedUser(data.user);
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

  const handleConfirmChangePassword = async () => {
    if (!savedUser || busy) return;
    const errors: Record<string, string> = {};
    const pwError = passwordErrorKey(newPassword, minPasswordLength);
    if (pwError) errors.newPassword = pwError;
    if (!newPasswordVerify) {
      errors.newPasswordVerify = "users.error.verifyRequired";
    } else if (newPasswordVerify !== newPassword) {
      errors.newPasswordVerify = "users.error.verifyMismatch";
    }
    setChangePasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const data = await api<{ user: SavedUser }>(USERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "change-password",
          id: savedUser.id,
          password: newPassword,
        }),
      });
      setSavedUser(data.user);
      setShowChangePassword(false);
      setNewPassword("");
      setNewPasswordVerify("");
      toast.success(t("newUser.passwordChanged"));
    } catch (error) {
      if (error instanceof ApiError && error.serverKey) {
        setChangePasswordErrors({ newPassword: error.serverKey });
        toast.error(
          t(error.serverKey, error.serverParams ?? undefined)
        );
      } else {
        toast.error(t("error.requestFailed", { status: "?" }));
      }
    } finally {
      setBusy(false);
    }
  };

  const locked = savedUser !== null;

  const labelClass =
    "block text-sm font-medium leading-none text-foreground mb-1";
  const fieldClass = "w-full";
  const fieldErrorClass = "mt-1 text-sm text-destructive";

  return (
    <>
      <BackLink to="/administration/users" label={t("users.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-xl">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground">
            {t("newUser.title")}
          </h1>

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
              <label htmlFor="login-name" className={labelClass}>
                {t("newUser.loginName")} *
              </label>
              <Input
                id="login-name"
                name="loginName"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                disabled={locked || saving}
                className={fieldClass}
              />
              {renderError(fieldErrors.loginName) && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.loginName)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>
                {t("newUser.password")} *
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={locked || saving}
                className={fieldClass}
              />
              {renderError(fieldErrors.password) && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.password, { min: minPasswordLength })}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="verify-password" className={labelClass}>
                {t("newUser.verifyPassword")} *
              </label>
              <Input
                id="verify-password"
                name="verifyPassword"
                type="password"
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                disabled={locked || saving}
                className={fieldClass}
              />
              {renderError(fieldErrors.verifyPassword) && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.verifyPassword)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className={labelClass}>
                {t("newUser.email")} *
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={locked || saving}
                className={fieldClass}
              />
              {renderError(fieldErrors.email) && (
                <p className={fieldErrorClass}>{t(fieldErrors.email)}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className={labelClass}>
                  {t("newUser.name")} *
                </label>
                <Input
                  id="name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={locked || saving}
                  className={fieldClass}
                />
                {renderError(fieldErrors.name) && (
                  <p className={fieldErrorClass}>{t(fieldErrors.name)}</p>
                )}
              </div>
              <div>
                <label htmlFor="surname" className={labelClass}>
                  {t("newUser.surname")} *
                </label>
                <Input
                  id="surname"
                  name="surname"
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  disabled={locked || saving}
                  className={fieldClass}
                />
                {renderError(fieldErrors.surname) && (
                  <p className={fieldErrorClass}>
                    {t(fieldErrors.surname)}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="company" className={labelClass}>
                {t("newUser.company")}{" "}
                <span className="font-normal text-muted-foreground">
                  {t("newUser.optional")}
                </span>
              </label>
              <Input
                id="company"
                name="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                disabled={locked || saving}
                className={fieldClass}
              />
            </div>

            <div>
              <span className={labelClass}>{t("newUser.groups")}</span>
              <div className="min-h-[3rem] rounded-md border border-input bg-muted/30 p-3">
                {savedUser && savedUser.groups.length > 0 ? (
                  <ul className="space-y-3">
                    {savedUser.groups.map((group) => (
                      <li key={group.name} className="text-sm">
                        <div className="font-medium text-foreground">
                          {group.name}{" "}
                          <span className="font-normal text-muted-foreground">
                            — {t("newUser.groupAccessMode")}: {group.accessMode}
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          {t("newUser.groupProjects")}:{" "}
                          {group.projects.length > 0
                            ? group.projects.join(", ")
                            : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="notify-email"
                name="notifyEmail"
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                disabled={locked || saving}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <label
                htmlFor="notify-email"
                className="text-sm text-foreground"
              >
                {t("newUser.notifyEmail")}
              </label>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("newUser.immutableNote")}
            </p>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="submit"
                disabled={locked || saving}
                aria-busy={saving}
              >
                {t("newUser.save")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!savedUser || busy}
                onClick={handleToggleDisabled}
              >
                {savedUser?.isDisabled
                  ? t("newUser.enable")
                  : t("newUser.disable")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!savedUser || busy}
                onClick={() => setShowChangePassword((v) => !v)}
              >
                {t("newUser.changePassword")}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/administration/users">
                  {t("newUser.backToUsers")}
                </Link>
              </Button>
            </div>
          </form>

          {showChangePassword && savedUser && (
            <div className="mt-6 rounded-md border p-4">
              <h2 className="mb-3 text-lg font-semibold text-foreground">
                {t("newUser.changePassword")}
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="new-password" className={labelClass}>
                    {t("newUser.newPassword")} *
                  </label>
                  <Input
                    id="new-password"
                    name="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={busy}
                    className={fieldClass}
                  />
                  {renderError(changePasswordErrors.newPassword) && (
                    <p className={fieldErrorClass}>
                      {t(changePasswordErrors.newPassword, {
                        min: minPasswordLength,
                      })}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="new-password-verify" className={labelClass}>
                    {t("newUser.verifyPassword")} *
                  </label>
                  <Input
                    id="new-password-verify"
                    name="newPasswordVerify"
                    type="password"
                    value={newPasswordVerify}
                    onChange={(e) => setNewPasswordVerify(e.target.value)}
                    disabled={busy}
                    className={fieldClass}
                  />
                  {renderError(changePasswordErrors.newPasswordVerify) && (
                    <p className={fieldErrorClass}>
                      {t(changePasswordErrors.newPasswordVerify)}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="button" disabled={busy} onClick={handleConfirmChangePassword}>
                    {t("newUser.confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setShowChangePassword(false);
                      setNewPassword("");
                      setNewPasswordVerify("");
                      setChangePasswordErrors({});
                    }}
                  >
                    {t("newUser.cancel")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {savedUser && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("newUser.statusPrefix")}: {savedUser.isDisabled
                ? t("newUser.statusDisabled")
                : t("newUser.statusEnabled")}{" "}
              ({savedUser.loginName})
            </p>
          )}
        </div>
      </div>
    </>
  );
};

export default NewUser;
