import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import OtpStep from "@/components/OtpStep";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import {
  confirmChange,
  cancelChange,
  profileErrorMessage,
  requestChange,
  type ChangeResult,
  type ProfileUser,
} from "@/lib/profile";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const labelClass =
  "block text-sm font-medium leading-none text-foreground mb-1";

/** Self-service email change: new email → OTP to the OLD mailbox → confirm. */
const ChangeEmailSection = ({
  user,
  onUpdated,
}: {
  user: ProfileUser;
  onUpdated: (user: ProfileUser) => void;
}) => {
  const { t } = useI18n();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState("email");
  const [demoOtp, setDemoOtp] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState("");

  const reset = () => {
    setStep("form");
    setNewEmail("");
    setError(null);
    setDemoOtp(undefined);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const email = newEmail.trim();
    if (!EMAIL_RE.test(email)) {
      setError(t("profile.error.invalidEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result: ChangeResult = await requestChange("email", { email });
      setDelivery(result.delivery);
      setDemoOtp(result.demoOtp);
      setSentTo(result.email || user.email);
      setStep("otp");
    } catch (err) {
      setError(profileErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (otp: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await confirmChange("email", otp, { email: newEmail.trim() });
      toast.success(t("profile.emailUpdated"));
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
          {t("profile.emailTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("profile.emailDescription")}
        </p>
      </div>

      {step === "form" ? (
        <form onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="profile-new-email" className={labelClass}>
              {t("profile.newEmail")}
            </label>
            <Input
              id="profile-new-email"
              name="newEmail"
              type="email"
              autoComplete="off"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setError(null);
              }}
              disabled={busy}
              className="w-full max-w-md"
            />
            {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
          </div>
          <div className="mt-4">
            <Button type="submit" disabled={busy || !newEmail.trim()} aria-busy={busy}>
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

export default ChangeEmailSection;
