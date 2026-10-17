import { useCallback, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import InstanceForm from "@/components/InstanceForm";
import {
  CONTAINERS_ENDPOINT,
  CUSTOM_TYPES_ENDPOINT,
  INSTANCES_ENDPOINT,
  TEMPLATES_ENDPOINT,
  formatDate,
  toFormValue,
  type FormState,
} from "@/lib/work-instance-form";
import type {
  CustomType,
  InstanceTemplate,
  ProgressOption,
  UserRef,
  WorkContainer,
  WorkInstance,
} from "@/lib/types";

/**
 * Work Instances page: list of work instances with edit/delete actions and
 * a "New Work Instance" button that navigates to the dedicated create page.
 *
 * Template management (reusable structures) is on a separate page:
 *  - New work instance → /work-area/:projectId/work-instances/new
 *  - Templates         → /work-area/:projectId/templates
 */
const WorkAreaInstances = () => {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [instances, setInstances] = useState<WorkInstance[]>([]);
  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [progressOptions, setProgressOptions] = useState<ProgressOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [instancesData, containersData, templatesData, customTypesData] =
        await Promise.all([
          api<{
            workInstances: WorkInstance[];
            users: UserRef[];
            progressOptions: ProgressOption[] | null;
          }>(INSTANCES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ workContainers: WorkContainer[] }>(CONTAINERS_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ templates: InstanceTemplate[] }>(TEMPLATES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "list",
              projectId: Number(projectId),
            }),
          }),
          api<{ customTypes: CustomType[] }>(CUSTOM_TYPES_ENDPOINT),
        ]);
      setInstances(instancesData.workInstances ?? []);
      setUsers(instancesData.users ?? []);
      setProgressOptions(instancesData.progressOptions ?? []);
      setContainers(containersData.workContainers ?? []);
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
    const editParam = searchParams.get("edit");
    if (editParam) {
      void openUpdate(Number(editParam), true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, projectId]);

  const openUpdate = async (
    instanceDbId: number,
    fromUrl = false
  ): Promise<void> => {
    try {
      const data = await api<{ workInstance: WorkInstance }>(
        INSTANCES_ENDPOINT,
        {
          method: "POST",
          body: JSON.stringify({ operation: "get", id: instanceDbId }),
        }
      );
      const instance = data.workInstance;
      const fieldValues: Record<string, unknown> = {};
      for (const field of instance.fields) {
        fieldValues[field.name] = toFormValue(field);
      }
      setForm({
        mode: "update",
        id: instanceDbId,
        name: instance.name,
        workContainerId: String(instance.workContainerId),
        templateId: instance.templateId ? String(instance.templateId) : "",
        progress: instance.progress ?? "",
        assigneeIds: instance.assigneeIds ?? [],
        fieldValues,
        adHoc: [],
      });
      if (fromUrl) {
        const next = new URLSearchParams(searchParams);
        next.delete("edit");
        setSearchParams(next, { replace: true });
      }
    } catch (err) {
      toast.error(translate(err));
    }
  };

  const closeForm = () => {
    setForm(null);
  };

  const handleDelete = async (instance: WorkInstance) => {
    if (
      !window.confirm(
        t("wa.deleteInstanceConfirm", { name: instance.name })
      )
    ) {
      return;
    }
    try {
      await api(INSTANCES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ operation: "delete", id: instance.id }),
      });
      toast.success(t("wa.instanceDeleted"));
      if (form?.id === instance.id) {
        closeForm();
      }
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const base = `/work-area/${projectId}`;

  return (
    <>
      <BackLink
        to={base}
        label={`${t("workArea.title")} — ${t("wa.workInstances")}`}
      />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("wa.workInstances")}
            </h1>
            <Button
              onClick={() => navigate(`${base}/work-instances/new`)}
            >
              {t("wa.newInstance")}
            </Button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {form && (
            <div className="mb-6">
              <InstanceForm
                form={form}
                setForm={setForm}
                projectId={projectId ?? ""}
                containers={containers}
                templates={templates}
                customTypes={customTypes}
                users={users}
                progressOptions={progressOptions}
                busy={busy}
                setBusy={setBusy}
                onSaved={() => {
                  closeForm();
                  void load();
                }}
                onCancel={closeForm}
              />
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : instances.length === 0 && !form ? (
            <p className="text-sm text-muted-foreground">
              {t("wa.emptyInstances")}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">{t("wa.instanceId")}</th>
                  <th className="px-2 py-2">{t("wa.name")}</th>
                  <th className="px-2 py-2">{t("wa.container")}</th>
                  <th className="px-2 py-2">{t("wa.template")}</th>
                  <th className="px-2 py-2">{t("wa.progress")}</th>
                  <th className="px-2 py-2">{t("wa.assignees")}</th>
                  <th className="px-2 py-2">{t("wa.updated")}</th>
                  <th className="px-2 py-2" aria-label="actions" />
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
                      {instance.templateName ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {instance.progress ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {(instance.assigneeIds ?? []).join(", ") || "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {formatDate(instance.updatedAt)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openUpdate(instance.id)}
                        >
                          {t("wa.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleDelete(instance)}
                        >
                          {t("wa.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkAreaInstances;
