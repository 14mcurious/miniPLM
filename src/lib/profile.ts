/**
 * MiniPLM profile API (self-service profile changes, OTP-confirmed).
 *
 * Every change is two-step against `/api/my/v1/profile`:
 *   1. change-* → the code is emailed to the user's CURRENT mailbox and
 *      the change is staged server-side;
 *   2. confirm  → the code + the re-sent payload apply the change.
 */
import { api, ApiError } from "./api";

const PROFILE_ENDPOINT = "/api/my/v1/profile";

export interface ProfileUser {
  loginName: string;
  email: string;
  name: string;
  surname: string;
  company: string | null;
  notifyEmail: boolean;
}

export type ProfileChangeKind = "email" | "password" | "name";

export interface ChangeResult {
  delivery: string;
  demoOtp?: string;
  email?: string;
}

export function fetchProfile(): Promise<ProfileUser> {
  return api<{ user: ProfileUser }>(PROFILE_ENDPOINT).then((d) => d.user);
}

export function requestChange(
  kind: ProfileChangeKind,
  payload: Record<string, unknown>
): Promise<ChangeResult> {
  const operation =
    kind === "email"
      ? "change-email"
      : kind === "password"
        ? "change-password"
        : "change-name";
  return api<ChangeResult>(PROFILE_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ operation, ...payload }),
  });
}

export function confirmChange(
  kind: ProfileChangeKind,
  otp: string,
  payload: Record<string, unknown>
): Promise<ProfileUser> {
  return api<{ user: ProfileUser }>(PROFILE_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ operation: "confirm", kind, otp, ...payload }),
  }).then((d) => d.user);
}

export function cancelChange(): Promise<void> {
  return api(PROFILE_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ operation: "cancel" }),
  });
}

/** Translate a profile/users API error into the active i18n message. */
export function profileErrorMessage(
  err: unknown,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (err instanceof ApiError && err.serverKey) {
    return t(err.serverKey, err.serverParams ?? undefined);
  }
  return t("error.requestFailed", { status: "?" });
}
