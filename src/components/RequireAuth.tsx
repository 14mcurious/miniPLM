import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";

/**
 * Wraps protected routes: shows an explicit loading state while the session
 * token is validated, and redirects to the login flow when unauthenticated.
 */
const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { t } = useI18n();
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      </div>
    );
  }
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

export default RequireAuth;
