/**
 * Client-side mirror of the MiniPLM security policy (password + login name
 * rules) enforced by the v1/users backend.
 *
 * The backend remains the source of truth: these defaults are only used as
 * fallback while the policy is being loaded (or when the endpoint is
 * unreachable), and the validation functions here mirror the server rules so
 * the user forms can give immediate feedback with the same i18n keys.
 */

export interface SecurityPolicy {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  loginNameAlnumOnly: boolean;
  loginNameMinLength: number;
  loginNameMaxLength: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  minPasswordLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
  loginNameAlnumOnly: true,
  loginNameMinLength: 3,
  loginNameMaxLength: 32,
};

const LOGIN_NAME_RE = /^[A-Za-z0-9]+$/;
const LOGIN_NAME_EXTENDED_RE = /^[A-Za-z0-9._-]+$/;
const SPECIAL_CHAR_RE = /[^A-Za-z0-9]/;

/** Merge a (possibly partial) server policy over the safe defaults. */
export function normalizeSecurityPolicy(
  raw: Partial<SecurityPolicy> | null | undefined
): SecurityPolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_SECURITY_POLICY;
  const int = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : fallback;
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    minPasswordLength: int(
      raw.minPasswordLength,
      DEFAULT_SECURITY_POLICY.minPasswordLength
    ),
    requireUppercase: bool(
      raw.requireUppercase,
      DEFAULT_SECURITY_POLICY.requireUppercase
    ),
    requireLowercase: bool(
      raw.requireLowercase,
      DEFAULT_SECURITY_POLICY.requireLowercase
    ),
    requireDigit: bool(raw.requireDigit, DEFAULT_SECURITY_POLICY.requireDigit),
    requireSpecial: bool(
      raw.requireSpecial,
      DEFAULT_SECURITY_POLICY.requireSpecial
    ),
    loginNameAlnumOnly: bool(
      raw.loginNameAlnumOnly,
      DEFAULT_SECURITY_POLICY.loginNameAlnumOnly
    ),
    loginNameMinLength: int(
      raw.loginNameMinLength,
      DEFAULT_SECURITY_POLICY.loginNameMinLength
    ),
    loginNameMaxLength: int(
      raw.loginNameMaxLength,
      DEFAULT_SECURITY_POLICY.loginNameMaxLength
    ),
  };
}

/** i18n error key for a password violating the policy, or null. */
export function passwordErrorKey(
  password: string,
  policy: SecurityPolicy
): string | null {
  if (!password) return "users.error.passwordRequired";
  if (password.length < policy.minPasswordLength) {
    return "users.error.passwordTooShort";
  }
  if (policy.requireSpecial && !SPECIAL_CHAR_RE.test(password)) {
    return "users.error.passwordSpecial";
  }
  if (policy.requireDigit && !/\d/.test(password)) {
    return "users.error.passwordDigit";
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return "users.error.passwordUppercase";
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    return "users.error.passwordLowercase";
  }
  return null;
}

/** i18n error key for a login name violating the policy, or null. */
export function loginNameErrorKey(
  loginName: string,
  policy: SecurityPolicy
): string | null {
  const value = loginName.trim();
  if (!value) return "users.error.loginNameRequired";
  if (value.length < policy.loginNameMinLength) {
    return "users.error.loginNameTooShort";
  }
  if (value.length > policy.loginNameMaxLength) {
    return "users.error.loginNameTooLong";
  }
  const allowed = policy.loginNameAlnumOnly
    ? LOGIN_NAME_RE
    : LOGIN_NAME_EXTENDED_RE;
  if (!allowed.test(value)) {
    return policy.loginNameAlnumOnly
      ? "users.error.loginNameFormat"
      : "users.error.loginNameFormatExtended";
  }
  return null;
}

/** Translate a policy error key with the matching {min}/{max} parameters. */
export function policyErrorParams(
  key: string,
  policy: SecurityPolicy
): Record<string, number> | undefined {
  switch (key) {
    case "users.error.passwordTooShort":
      return { min: policy.minPasswordLength };
    case "users.error.loginNameTooShort":
      return { min: policy.loginNameMinLength };
    case "users.error.loginNameTooLong":
      return { max: policy.loginNameMaxLength };
    default:
      return undefined;
  }
}
