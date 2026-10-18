import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import {
  AttachmentValue,
  UserRef,
  WorkContainer,
  WorkInstance,
  WorkInstanceField,
} from "@/lib/types";

const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";
const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";
const ATTACHMENTS_ENDPOINT = "/api/my/v1/attachments";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

async function downloadAttachment(s3Key: string): Promise<void> {
  const data = await api<{ attachment: { fileName: string; content: string } }>(
    ATTACHMENTS_ENDPOINT,
    {
      method: "POST",
      body: JSON.stringify({ operation: "download", s3Key }),
    }
  );
  const byteChars = atob(data.attachment.content);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = data.attachment.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Work instance detail: all attributes and the typed fields (number,
 * date, string, attachment download, html render, xml view, custom
 * values).
 */
const WorkAreaInstanceDetail = () => {
  const { t } = useI18n();
  const { projectId, instanceId } = useParams<{
    projectId: string;
    instanceId: string;
  }>();
  const { status } = useAuth();
  const navigate = useNavigate();

  const [instance, setInstance] = useState<WorkInstance | null>(null);
  const [containerWorkspaceId, setContainerWorkspaceId] = useState<
    number | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const [data, containersData] = await Promise.all([
        api<{ workInstance: WorkInstance }>(INSTANCES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({ operation: "get", id: Number(instanceId) }),
        }),
        projectId
          ? api<{ workContainers: WorkContainer[] }>(CONTAINERS_ENDPOINT, {
              method: "POST",
              body: JSON.stringify({
                operation: "list",
                projectId: Number(projectId),
              }),
            })
          : Promise.resolve({ workContainers: [] }),
      ]);
      const foundInstance = data.workInstance ?? null;
      setInstance(foundInstance);
      if (foundInstance) {
        const container = containersData.workContainers?.find(
          (item) =>
            String(item.id) === String(foundInstance.workContainerId)
        );
        setContainerWorkspaceId(container?.workspaceId ?? null);
      }
    } catch (err) {
      const key = err instanceof ApiError ? err.serverKey : null;
      if (
        key === "forbidden" ||
        key === "workInstances.error.notFound"
      ) {
        setNotFound(true);
      } else {
        toast.error(translate(err));
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
    }
  }, [status, load]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const base = `/work-area/${projectId}`;

  const renderFieldValue = (field: WorkInstanceField) => {
    const value = field.value;
    if (value === null || value === undefined || value === "") {
      return <span className="text-muted-foreground">—</span>;
    }
    if (field.type === "attachment" && typeof value === "object") {
      const attachment = value as AttachmentValue;
      return (
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => void downloadAttachment(attachment.s3Key)}
        >
          {attachment.fileName} ({Math.round(attachment.size / 1024)} KB)
        </button>
      );
    }
    if (field.type === "html") {
      return (
        <div
          className="prose prose-sm max-w-none rounded-md border bg-muted/30 p-3 text-sm text-foreground"
          // HTML authored by the same project members; rendered as-is.
          dangerouslySetInnerHTML={{ __html: String(value) }}
        />
      );
    }
    if (field.type === "xml") {
      return (
        <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs text-foreground">
          {String(value)}
        </pre>
      );
    }
    if (Array.isArray(value)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((item, index) => (
            <span
              key={index}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
            >
              {String(item)}
            </span>
          ))}
        </span>
      );
    }
    return <span>{String(value)}</span>;
  };

  return (
    <>
      <BackLink
        to={
          containerWorkspaceId != null
            ? `${base}/workspaces/${containerWorkspaceId}`
            : `${base}/workspaces`
        }
        label={t("wa.workspace")}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : notFound || !instance ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("wa.instanceNotFound")}
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  {instance.name}
                </h1>
                <span className="font-mono text-sm text-muted-foreground">
                  {instance.instanceId}
                </span>
              </div>
              <p className="mb-6 text-sm text-muted-foreground">
                {t("wa.container")}:{" "}
                <Link
                  to={`${base}/work-containers/${instance.workContainerId}`}
                  className="text-primary hover:underline"
                >
                  {instance.workContainerName}
                </Link>
              </p>

              <div className="mb-8 rounded-lg border bg-card p-5 shadow-sm">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.author")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatUser(instance.author)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.progress")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {instance.progress ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.template")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {instance.templateName ?? t("wa.templateNone")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.created")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatDate(instance.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.updated")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatDate(instance.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("wa.assignees")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {(instance.assignees ?? []).length === 0
                        ? "—"
                        : (instance.assignees ?? [])
                            .map(
                              (user) => `${user.name} ${user.surname}`
                            )
                            .join(", ")}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mb-8 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-foreground">
                  {t("wa.fields")}
                </h2>
                <Button
                  variant="outline"
                  onClick={() =>
                    navigate(
                      containerWorkspaceId != null
                        ? `${base}/workspaces/${containerWorkspaceId}?edit=${instance.id}`
                        : `${base}/workspaces`
                    )
                  }
                >
                  {t("wa.edit")}
                </Button>
              </div>

              {instance.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("wa.noFields")}
                </p>
              ) : (
                <div className="space-y-3">
                  {instance.fields.map((field) => (
                    <div key={field.name} className="rounded-md border p-3">
                      <div className="mb-1 flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {field.name}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t(`fieldType.${field.type}`)}
                        </span>
                      </div>
                      {field.description && (
                        <p className="mb-2 text-xs text-muted-foreground">
                          {field.description}
                        </p>
                      )}
                      {renderFieldValue(field)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaInstanceDetail;
