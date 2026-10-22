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

const labelClass =
  "block text-sm font-medium leading-none text-foreground mb-1";

/** Self-service name/surname correction: values → OTP → confirm. */
const ChangeNameSection = ({
  user,
  onUpdated,
}: {
  user: ProfileUser;
  onUpdated: (user: ProfileUser) => void;
}) => {
  const { t } = useI18n();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [name, setName] = useState(user.name);
  const [surname, setSurname] = useState(user.surname);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState("email");
  const [demoOtp, setDemoOtp] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState("");

  const reset = () => {
    setStep("form");
    setName(user.name);
    setSurname(user.surname);
    setError(null);
    setDemoOtp(undefined);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim() || !surname.trim()) {
      setError(t("profile.error.invalidValue"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result: ChangeResult = await requestChange("name", {
        name: name.trim(),
        surname: surname.trim(),
      });
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
      const updated = await confirmChange("name", otp, {
        name: name.trim(),
        surname: surname.trim(),
      });
      toast.success(t("profile.nameUpdated"));
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
          {t("profile.nameTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("profile.nameDescription")}
        </p>
      </div>

      {step === "form" ? (
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="profile-name" className={labelClass}>
                {t("profile.nameLabel")}
              </label>
              <Input
                id="profile-name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="profile-surname" className={labelClass}>
                {t("profile.surnameLabel")}
              </label>
              <Input
                id="profile-surname"
                name="surname"
                type="text"
                value={surname}
                onChange={(e) => {
                  setSurname(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                className="w-full"
              />
            </div>
          </div>
          {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
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

export default ChangeNameSection;
