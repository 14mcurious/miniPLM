import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";

interface BackLinkProps {
  /** Logical route of the parent page (e.g. "/administration"). */
  to: string;
  /** Translated title of the parent page (e.g. t("administration.title")). */
  label: string;
}

/** Link back to the parent page, shown on every non-root page. */
const BackLink = ({ to, label }: BackLinkProps) => {
  const { t } = useI18n();

  return (
    <div className="fixed left-4 top-3 z-50">
      <Link
        to={to}
        className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        ← {t("nav.backTo", { name: label })}
      </Link>
    </div>
  );
};

export default BackLink;
