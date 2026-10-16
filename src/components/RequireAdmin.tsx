import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";

/**
 * Wraps the Administration area: only members of the SysAdmin group may
 * enter. The backend enforces the same rule on every admin endpoint; this
 * guard keeps the UI consistent (and redirects elsewhere otherwise).
 */
const RequireAdmin = ({ children }: { children: React.ReactNode }) => {
  const { t } = useI18n();
  const { status, isAdmin } = useAuth();
  const warned = useRef(false);

  useEffect(() => {
    if (status === "authenticated" && !isAdmin && !warned.current) {
      warned.current = true;
      toast.error(t("access.forbidden"));
    }
  }, [status, isAdmin, t]);

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
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

export default RequireAdmin;
