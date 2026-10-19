import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/i18n";
import {
  api,
  onSessionInvalid,
  setAuthHeaders,
} from "@/lib/api";

const AUTH_ENDPOINT = "/api/my/v1/auth";
const TOKEN_KEY = "miniplm.token";
const CSRF_KEY = "miniplm.csrf";

export interface AuthUser {
  id: number;
  loginName: string;
  email: string;
  name: string;
  surname: string;
  company: string | null;
}

export interface WorkAreaRef {
  id: number;
  name: string;
  /** Union of the access modes granted by the user's groups (C/R/U/D). */
  modes?: string;
}

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  isAdmin: boolean;
  workAreas: WorkAreaRef[];
  /** Unix seconds. */
  expiresAt: number;
  /** Unix seconds: moment when the extension prompt must be shown. */
  warningAt: number;
}

interface AuthContextValue extends AuthState {
  /** Step 1 of the login flow: verify credentials, trigger the OTP email. */
  login: (loginName: string, password: string) => Promise<{
    sent: boolean;
    delivery: string;
    demoOtp?: string;
    email?: string;
  }>;
  /** Step 2 of the login flow: verify the OTP and open the session. */
  verifyOtp: (loginName: string, otp: string) => Promise<void>;
  /** Extend the current session by one full configured duration. */
  extend: () => Promise<void>;
  /** End the current session (server-side + local). */
  logout: () => Promise<void>;
  /** True while the "session expiring" modal prompt is visible. */
  sessionPrompt: boolean;
  /** True once the user declined the prompt (countdown banner mode). */
  sessionPromptDeclined: boolean;
  declineSessionPrompt: () => void;
}

const initialAuthState: AuthState = {
  status: "loading",
  user: null,
  isAdmin: false,
  workAreas: [],
  expiresAt: 0,
  warningAt: 0,
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken(): { token: string; csrf: string } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  return { token, csrf: localStorage.getItem(CSRF_KEY) ?? "" };
}

function storeToken(token: string, csrf: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(CSRF_KEY, csrf);
}

function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CSRF_KEY);
}

function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Ticks every second while `active` is true (drives the countdowns). */
function useTick(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>(initialAuthState);
  const [sessionPrompt, setSessionPrompt] = useState(false);
  const [sessionPromptDeclined, setSessionPromptDeclined] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Force logout (token rejected server-side or naturally expired).
  const forceLogout = useCallback(() => {
    clearStoredToken();
    setAuthHeaders(null, null);
    setState((prev) => ({
      ...prev,
      status: "unauthenticated",
      user: null,
      isAdmin: false,
      workAreas: [],
      expiresAt: 0,
      warningAt: 0,
    }));
    setSessionPrompt(false);
    setSessionPromptDeclined(false);
  }, []);

  // Any API call rejected with session/csrf errors => the session is dead.
  useEffect(() => {
    return onSessionInvalid(() => {
      if (stateRef.current.status === "authenticated") {
        forceLogout();
      }
    });
  }, [forceLogout]);

  // Boot: restore the persisted opaque token through the `me` endpoint.
  // The backend token check is the single source of truth; nothing cached
  // in the browser is ever trusted as an authenticated identity.
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      setState((prev) => ({ ...prev, status: "unauthenticated" }));
      return;
    }
    setAuthHeaders(stored.token, stored.csrf || null);
    api<any>(AUTH_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "me" }),
    })
      .then((data) => {
        if (data?.ok) {
          setAuthHeaders(data.token, data.csrfToken);
          setState({
            status: "authenticated",
            user: data.user,
            isAdmin: !!data.isAdmin,
            workAreas: data.workAreas ?? [],
            expiresAt: data.expiresAt,
            warningAt: data.warningAt,
          });
        } else {
          forceLogout();
        }
      })
      .catch(() => {
        forceLogout();
      });
  }, [forceLogout]);

  // Expiry watcher: 15s poll. When the session reaches its natural end the
  // user is forced to log in again. When the warning threshold is reached
  // the extension prompt is shown.
  useEffect(() => {
    if (state.status !== "authenticated") return;
    const check = () => {
      const now = Math.floor(Date.now() / 1000);
      const { expiresAt, warningAt } = stateRef.current;
      if (now >= expiresAt) {
        forceLogout();
        return;
      }
      if (now >= warningAt) {
        setSessionPrompt(true);
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [state.status, forceLogout]);

  const login = useCallback(async (loginName: string, password: string) => {
    const data = await api<any>(AUTH_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "login", loginName, password }),
    });
    return {
      sent: !!data.sent,
      delivery: data.delivery ?? "email",
      demoOtp: data.demoOtp,
      email: data.email,
    };
  }, []);

  const verifyOtp = useCallback(async (loginName: string, otp: string) => {
    const data = await api<any>(AUTH_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "verify-otp", loginName, otp }),
    });
    if (!data?.ok || !data.token) {
      throw new Error("wrong credentials");
    }
    storeToken(data.token, data.csrfToken ?? "");
    setAuthHeaders(data.token, data.csrfToken ?? null);
    setState({
      status: "authenticated",
      user: data.user,
      isAdmin: !!data.isAdmin,
      workAreas: data.workAreas ?? [],
      expiresAt: data.expiresAt,
      warningAt: data.warningAt,
    });
    setSessionPrompt(false);
    setSessionPromptDeclined(false);
  }, []);

  const extend = useCallback(async () => {
    const data = await api<any>(AUTH_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ operation: "extend" }),
    });
    if (data?.ok) {
      setState((prev) => ({
        ...prev,
        expiresAt: data.expiresAt,
        warningAt: data.warningAt,
      }));
      setSessionPrompt(false);
      setSessionPromptDeclined(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api(AUTH_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "logout" }),
      });
    } catch {
      // The session may already be expired; the local cleanup still applies.
    }
    forceLogout();
  }, [forceLogout]);

  const declineSessionPrompt = useCallback(() => {
    setSessionPrompt(false);
    setSessionPromptDeclined(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      verifyOtp,
      extend,
      logout,
      sessionPrompt,
      sessionPromptDeclined,
      declineSessionPrompt,
    }),
    [
      state,
      login,
      verifyOtp,
      extend,
      logout,
      sessionPrompt,
      sessionPromptDeclined,
      declineSessionPrompt,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SessionExpiryPrompt />
    </AuthContext.Provider>
  );
};

/**
 * Global "session expiring soon" prompt. Shown when the session reaches the
 * configured warning threshold (default: 10 minutes before expiry). If the
 * user declines, a countdown banner stays visible until the session is
 * extended or expires (forcing a new login).
 */
const SessionExpiryPrompt = () => {
  const { t } = useI18n();
  const {
    status,
    expiresAt,
    sessionPrompt,
    sessionPromptDeclined,
    declineSessionPrompt,
    extend,
  } = useAuth();
  const [busy, setBusy] = useState(false);
  const active =
    status === "authenticated" && (sessionPrompt || sessionPromptDeclined);
  const nowMs = useTick(active);
  const remaining = active ? expiresAt - Math.floor(nowMs / 1000) : 0;

  if (!active) return null;

  const handleExtend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await extend();
    } catch {
      // A failed extension (e.g. the session is already gone) is handled by
      // the global session-invalid listener; the countdown ends the session.
    } finally {
      setBusy(false);
    }
  };

  if (sessionPrompt) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expiry-title"
      >
        <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
          <h2
            id="session-expiry-title"
            className="text-lg font-semibold text-foreground"
          >
            {t("session.expiryTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("session.expiryBody")}{" "}
            <span className="font-mono tabular-nums">
              {formatCountdown(remaining)}
            </span>
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={declineSessionPrompt}
              className="rounded-md border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {t("session.expiryDecline")}
            </button>
            <button
              type="button"
              onClick={handleExtend}
              disabled={busy}
              aria-busy={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("session.expiryExtend")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,40rem)] -translate-x-1/2 items-center justify-between gap-4 rounded-lg border border-amber-500/50 bg-amber-50 px-4 py-3 text-amber-950 shadow-lg dark:border-amber-400/40 dark:bg-amber-950/90 dark:text-amber-100">
      <p className="text-sm">
        {t("session.expiringSoon")}{" "}
        <span className="font-mono font-semibold tabular-nums">
          {formatCountdown(remaining)}
        </span>
      </p>
      <button
        type="button"
        onClick={handleExtend}
        disabled={busy}
        aria-busy={busy}
        className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {t("session.expiryExtend")}
      </button>
    </div>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
