import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { progressLabel } from "@/lib/workflow-progress";
import { Button } from "@/components/ui/button";
import { UserRef, WorkContainer } from "@/lib/types";

const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

interface WorkAreaContainersTableProps {
  /** Work area base path, e.g. /work-area/<projectId>. */
  base: string;
  containers: WorkContainer[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (container: WorkContainer) => void;
  onDeleted: () => void;
}

/**
 * Work containers table of a work space. Read-only rows (identifier, name,
 * progress, author, instance count, updated at) plus the per-row edit and
 * delete actions, each shown only when the project modes allow them.
 * Progress cells carry the workflow state label of the container's own
 * template progress workflow as a hover tooltip.
 */
const WorkAreaContainersTable = ({
  base,
  containers,
  canEdit,
  canDelete,
  onEdit,
  onDeleted,
}: WorkAreaContainersTableProps) => {
  const { t } = useI18n();

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const handleDelete = async (container: WorkContainer) => {
    if (
      !window.confirm(t("wa.deleteContainerConfirm", { name: container.name }))
    ) {
      return;
    }
    try {
      await api(CONTAINERS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "delete", id: container.id }),
      });
      toast.success(t("wa.containerDeleted"));
      onDeleted();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-2 py-2">{t("wa.identifier")}</th>
          <th className="px-2 py-2">{t("wa.name")}</th>
          <th className="px-2 py-2">{t("wa.progress")}</th>
          <th className="px-2 py-2">{t("wa.author")}</th>
          <th className="px-2 py-2">{t("wa.instances")}</th>
          <th className="px-2 py-2">{t("wa.updated")}</th>
          <th className="px-2 py-2" aria-label="actions" />
        </tr>
      </thead>
      <tbody>
        {containers.map((container) => (
          <tr key={container.id} className="border-b hover:bg-muted/40">
            <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
              {container.identifier}
            </td>
            <td className="px-2 py-2 font-medium text-foreground">
              <Link
                to={`${base}/work-containers/${container.id}`}
                className="hover:underline"
              >
                {container.name}
              </Link>
              {container.title && (
                <span className="ml-2 text-muted-foreground">
                  — {container.title}
                </span>
              )}
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              <span
                title={progressLabel(
                  container.progressWorkflow,
                  container.progress
                )}
              >
                {container.progress ?? "—"}
              </span>
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              {formatUser(container.author)}
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              {container.instanceCount}
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              {formatDate(container.updatedAt)}
            </td>
            <td className="px-2 py-2 text-right">
              <div className="flex justify-end gap-2">
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(container)}
                  >
                    {t("wa.edit")}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDelete(container)}
                  >
                    {t("wa.delete")}
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default WorkAreaContainersTable;
