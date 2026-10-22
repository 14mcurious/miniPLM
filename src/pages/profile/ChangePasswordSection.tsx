import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import OtpStep from "@/components/OtpStep";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import {
  confirmChange,
  cancelChange,
  profileErrorMessage,
  requestChange,
  type ChangeResult,
  type ProfileUser,
} from "@/lib/profile";

const labelClass =
  "block text-sm font-medium leading-none text-foreground mb-1";
const fieldErrorClass = "mt-1 text-sm text-destructive";

/**
 * Self-service password change: the user must type the CURRENT password
 * (plus the new one, verified) and then the one-time code emailed to
 * their CURRENT mailbox.
 */
const ChangePasswordSection = ({
  user,
  onUpdated,
}: {
  user: ProfileUser;
  onUpdated: (user: ProfileUser) => void;
}) => {
  const { t } = useI18n();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState("email");
  const [demoOtp, setDemoOtp] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState("");

  const reset = () => {
    setStep("form");
    setCurrentPassword("");
    setNewPassword("");
    setVerifyPassword("");
    setError(null);
    setFieldErrors({});
    setDemoOtp(undefined);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errors: Record<string, string> = {};
    if (!currentPassword) errors.currentPassword = t("profile.error.invalidValue");
    if (!newPassword) errors.newPassword = t("users.error.passwordRequired");
    if (!verifyPassword) errors.verifyPassword = t("users.error.verifyRequired");
    else if (verifyPassword !== newPassword)
      errors.verifyPassword = t("users.error.verifyMismatch");
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const result: ChangeResult = await requestChange("password", {
        currentPassword,
        newPassword,
        verifyPassword,
      });
      setDelivery(result.delivery);
      setDemoOtp(result.demoOtp);
      setSentTo(result.email || user.email);
      setStep("otp");
    } catch (err) {
      if (err instanceof ApiError && err.serverKey) {
        if (err.serverKey === "profile.error.wrongCurrentPassword") {
          setFieldErrors({ currentPassword: err.serverKey });
        } else if (err.serverKey.startsWith("users.error.password")) {
          setFieldErrors({ newPassword: err.serverKey });
        } else {
          setError(profileErrorMessage(err, t));
        }
      } else {
        setError(profileErrorMessage(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (otp: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await confirmChange("password", otp, { newPassword });
      toast.success(t("profile.passwordUpdated"));
      onUpdated(updated);
      reset();
    } catch (err) {
      setError(profileErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    cancelChange().catch(() => undefined);
    reset();
  };

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {t("profile.passwordTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("profile.passwordDescription")}
        </p>
      </div>

      {step === "form" ? (
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            <div>
              <label htmlFor="profile-current-password" className={labelClass}>
                {t("profile.currentPassword")}
              </label>
              <Input
                id="profile-current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setFieldErrors((f) => ({ ...f, currentPassword: "" }));
                }}
                disabled={busy}
                className="w-full max-w-md"
              />
              {fieldErrors.currentPassword && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.currentPassword)}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="profile-new-password" className={labelClass}>
                {t("profile.newPassword")}
              </label>
              <Input
                id="profile-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setFieldErrors((f) => ({ ...f, newPassword: "" }));
                }}
                disabled={busy}
                className="w-full max-w-md"
              />
              {fieldErrors.newPassword && (
                <p className={fieldErrorClass}>{t(fieldErrors.newPassword)}</p>
              )}
            </div>
            <div>
              <label htmlFor="profile-verify-password" className={labelClass}>
                {t("profile.verifyPassword")}
              </label>
              <Input
                id="profile-verify-password"
                name="verifyPassword"
                type="password"
                autoComplete="new-password"
                value={verifyPassword}
                onChange={(e) => {
                  setVerifyPassword(e.target.value);
                  setFieldErrors((f) => ({ ...f, verifyPassword: "" }));
                }}
                disabled={busy}
                className="w-full max-w-md"
              />
              {fieldErrors.verifyPassword && (
                <p className={fieldErrorClass}>
                  {t(fieldErrors.verifyPassword)}
                </p>
              )}
            </div>
          </div>
          {error && <p role="alert" className={fieldErrorClass}>{error}</p>}
          <div className="mt-4">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {t("profile.submitOtp")}
            </Button>
          </div>
        </form>
      ) : (
        <OtpStep
          info={`${t("profile.otpSentTo")} ${sentTo || user.email}`}
          delivery={delivery}
          demoOtp={demoOtp}
          error={error}
          confirmLabel={t("profile.otpConfirm")}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </section>
  );
};

export default ChangePasswordSection;
