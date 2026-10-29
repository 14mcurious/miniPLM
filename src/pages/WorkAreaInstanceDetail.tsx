import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useProjectModes } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import { allowedProgressOptions, progressLabel } from "@/lib/workflow-progress";
import FieldValue from "@/components/FieldValue";
import InstanceForm from "@/components/InstanceForm";
import { Button } from "@/components/ui/button";
import {
  CUSTOM_TYPES_ENDPOINT,
  TEMPLATES_ENDPOINT,
  toFormValue,
  type FormState,
} from "@/lib/work-instance-form";
import {
  CustomType,
  InstanceTemplate,
  UserRef,
  WorkContainer,
  WorkInstance,
} from "@/lib/types";

const INSTANCES_ENDPOINT = "/api/my/v1/work-instances";
const CONTAINERS_ENDPOINT = "/api/my/v1/work-containers";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

const formatUser = (user: UserRef | null): string =>
  user ? `${user.name} ${user.surname}` : "—";

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
  const { can } = useProjectModes(projectId);

  const [instance, setInstance] = useState<WorkInstance | null>(null);
  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [editBusy, setEditBusy] = useState(false);
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
          ? api<{
              workContainers: WorkContainer[];
              userRoles: string[];
            }>(CONTAINERS_ENDPOINT, {
              method: "POST",
              body: JSON.stringify({
                operation: "list",
                projectId: Number(projectId),
              }),
            })
          : Promise.resolve({ workContainers: [], userRoles: [] }),
      ]);
      const foundInstance = data.workInstance ?? null;
      setInstance(foundInstance);
      setContainers(containersData.workContainers ?? []);
      setUserRoles(containersData.userRoles ?? []);
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

  // Open the inline edit form (update mode): the form data (templates,
  // custom types, users) is fetched on demand so the detail page stays
  // light when no edit is started.
  const openEdit = async () => {
    if (!instance) return;
    try {
      const [templatesData, customTypesData, instancesData] =
        await Promise.all([
          api<{ templates: InstanceTemplate[] }>(TEMPLATES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ customTypes: CustomType[] }>(CUSTOM_TYPES_ENDPOINT),
          api<{ users: UserRef[] }>(INSTANCES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
        ]);
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
      setUsers(instancesData.users ?? []);
      const fieldValues: Record<string, unknown> = {};
      for (const field of instance.fields) {
        fieldValues[field.name] = toFormValue(field);
      }
      setEditing({
        mode: "update",
        id: instance.id,
        title: instance.title,
        workContainerId: String(instance.workContainerId),
        templateId: instance.templateId ? String(instance.templateId) : "",
        progress: instance.progress ?? "",
        assigneeIds: instance.assigneeIds ?? [],
        fieldValues,
      });
    } catch (err) {
      toast.error(translate(err));
    }
  };

  const editTemplate = editing
    ? templates.find(
        (template) => String(template.id) === editing.templateId
      ) ?? null
    : null;

  return (
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
                  {instance.title}
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
                  {instance.workContainerTitle}
                </Link>
              </p>

              {editing && (
                <div className="mb-8">
                  <InstanceForm
                    form={editing}
                    setForm={setEditing}
                    projectId={projectId ?? ""}
                    containers={containers}
                    templates={templates}
                    customTypes={customTypes}
                    users={users}
                    progressOptions={allowedProgressOptions(
                      editTemplate?.progressWorkflow ?? null,
                      userRoles,
                      editing.progress,
                      "update"
                    )}
                    progressEnabled={editTemplate?.progressWorkflow != null}
                    busy={editBusy}
                    setBusy={setEditBusy}
                    onSaved={() => {
                      setEditing(null);
                      void load();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}

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
                      <span
                        title={progressLabel(
                          instance.progressWorkflow,
                          instance.progress
                        )}
                      >
                        {instance.progress ?? "—"}
                      </span>
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
                {can("U") && (
                  <Button
                    variant="outline"
                    onClick={() => void openEdit()}
                  >
                    {t("wa.edit")}
                  </Button>
                )}
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
                      <FieldValue field={field} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
    </div>
  );
};

export default WorkAreaInstanceDetail;
