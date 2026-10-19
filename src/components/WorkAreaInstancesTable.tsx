import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import { progressLabel } from "@/lib/workflow-progress";
import { ProgressWorkflow, WorkInstance } from "@/lib/types";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

interface WorkAreaInstancesTableProps {
  /** Work area base path, e.g. /work-area/<projectId>. */
  base: string;
  instances: WorkInstance[];
  progressWorkflow: ProgressWorkflow | null;
}

/**
 * Read-only table of the work instances of a work space's containers.
 * Progress cells carry the workflow state description as a hover tooltip.
 */
const WorkAreaInstancesTable = ({
  base,
  instances,
  progressWorkflow,
}: WorkAreaInstancesTableProps) => {
  const { t } = useI18n();

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-2 py-2">{t("wa.instanceId")}</th>
          <th className="px-2 py-2">{t("wa.name")}</th>
          <th className="px-2 py-2">{t("wa.container")}</th>
          <th className="px-2 py-2">{t("wa.progress")}</th>
          <th className="px-2 py-2">{t("wa.assignees")}</th>
          <th className="px-2 py-2">{t("wa.updated")}</th>
        </tr>
      </thead>
      <tbody>
        {instances.map((instance) => (
          <tr key={instance.id} className="border-b hover:bg-muted/40">
            <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
              {instance.instanceId}
            </td>
            <td className="px-2 py-2 font-medium text-foreground">
              <Link
                to={`${base}/work-instances/${instance.id}`}
                className="hover:underline"
              >
                {instance.name}
              </Link>
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              {instance.workContainerName}
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              <span title={progressLabel(progressWorkflow, instance.progress)}>
                {instance.progress ?? "—"}
              </span>
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              {(instance.assigneeIds ?? []).join(", ") || "—"}
            </td>
            <td className="px-2 py-2 text-muted-foreground">
              {formatDate(instance.updatedAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default WorkAreaInstancesTable;
