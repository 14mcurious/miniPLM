import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

const labelClass = "block text-sm font-medium leading-none text-foreground mb-1";
const fieldErrorClass = "mt-1 text-sm text-destructive";

interface OtpStepProps {
  /** Translated info line shown above the code input. */
  info: string;
  /** "dev" → demo mode: the code is displayed inline (no SMTP configured). */
  delivery: string;
  demoOtp?: string;
  /** Translated error to display, if any. */
  error: string | null;
  confirmLabel: string;
  onConfirm: (otp: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Two-step confirmation UI: the user (or the administrator, who relays
 * the code read by the affected user) types the one-time code emailed
 * to the user's CURRENT mailbox.
 */
const OtpStep = ({
  info,
  delivery,
  demoOtp,
  error,
  confirmLabel,
  onConfirm,
  onCancel,
}: OtpStepProps) => {
  const { t } = useI18n();
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || otp.length < 6) return;
    setBusy(true);
    try {
      await onConfirm(otp);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleConfirm} noValidate>
      <p className="mb-3 text-sm text-muted-foreground">{info}</p>
      {delivery === "dev" && demoOtp && (
        <p className="mb-3 text-sm text-foreground">
          {t("profile.otpDemoCode")}{" "}
          <span className="font-mono font-semibold tracking-widest">
            {demoOtp}
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className={fieldErrorClass}>
          {error}
        </p>
      )}
      <div className="mb-4">
        <label htmlFor="otp-step-code" className={labelClass}>
          {t("profile.otpLabel")}
        </label>
        <Input
          id="otp-step-code"
          name="otp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="one-time-code"
          autoFocus
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          placeholder={t("profile.otpPlaceholder")}
          className="w-40 font-mono text-center text-lg tracking-[0.5em]"
          disabled={busy}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || otp.length < 6} aria-busy={busy}>
          {confirmLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOtp("");
            onCancel();
          }}
        >
          {t("profile.otpCancel")}
        </Button>
      </div>
    </form>
  );
};

export default OtpStep;
