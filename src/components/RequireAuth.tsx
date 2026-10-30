import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";

/**
 * Wraps protected routes: shows an explicit loading state while the session
 * token is validated, and redirects to the login flow when unauthenticated.
 * The requested destination is passed along (location.state.from) so the
 * login flow can return to it after authentication — this is what makes
 * deep links opened in a fresh (unauthenticated) tab work end to end.
 */
const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { t } = useI18n();
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      </div>
    );
  }
  if (status === "unauthenticated") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
};

export default RequireAuth;
