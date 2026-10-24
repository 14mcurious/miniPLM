import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useProjectModes } from "@/hooks/usePermissions";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import InstanceForm from "@/components/InstanceForm";
import { allowedProgressOptions } from "@/lib/workflow-progress";
import {
  CONTAINERS_ENDPOINT,
  CUSTOM_TYPES_ENDPOINT,
  INSTANCES_ENDPOINT,
  TEMPLATES_ENDPOINT,
  emptyForm,
  type FormState,
} from "@/lib/work-instance-form";
import type {
  CustomType,
  InstanceTemplate,
  ProgressOption,
  ProgressWorkflow,
  UserRef,
  WorkContainer,
} from "@/lib/types";

/**
 * New Work Instance page (inside a work space): dedicated page for creating
 * a new work instance. The container list is limited to the containers of
 * the selected work space, so an instance is always created inside a work
 * space.
 */
const WorkAreaInstanceNew = () => {
  const { t } = useI18n();
  const { projectId, workspaceId } = useParams<{
    projectId: string;
    workspaceId: string;
  }>();
  const { status } = useAuth();
  const navigate = useNavigate();
  const { can } = useProjectModes(projectId);

  const [containers, setContainers] = useState<WorkContainer[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
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
    if (!projectId || !workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [instancesData, containersData, templatesData, customTypesData] =
        await Promise.all([
          api<{
            users: UserRef[];
            progressOptions: ProgressOption[] | null;
            progressWorkflow: ProgressWorkflow | null;
            userRoles: string[];
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
              workspaceId: Number(workspaceId),
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
      setUsers(instancesData.users ?? []);
      setUserRoles(instancesData.userRoles ?? []);
      setContainers(containersData.workContainers ?? []);
      setTemplates(templatesData.templates ?? []);
      setCustomTypes(customTypesData.customTypes ?? []);
      const first = containersData.workContainers?.[0];
      setForm({
        ...emptyForm(),
        workContainerId: first ? String(first.id) : "",
      });
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (status === "authenticated") {
      void load();
    }
  }, [status, load]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const base = `/work-area/${projectId}`;
  const workspaceBack = `${base}/workspaces/${workspaceId}`;

  // Progress is a template field: the offered choices come from the
  // workflow progress type referenced by the selected template (initial
  // state on create). Without a progress field the control is absent.
  const selectedTemplate = form
    ? templates.find(
        (template) => String(template.id) === form.templateId
      ) ?? null
    : null;
  const progressWorkflow = selectedTemplate?.progressWorkflow ?? null;
  const progressOptions = allowedProgressOptions(
    progressWorkflow,
    userRoles,
    form?.progress ?? "",
    form?.mode === "create" ? "create" : "update"
  );

  return (
    <>
      <BackLink to={workspaceBack} label={t("wa.workspaces")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
          <h1 className="mb-6 text-3xl font-bold tracking-tight text-foreground">
            {form?.mode === "update"
              ? t("wa.editInstanceTitle")
              : t("wa.newInstanceTitle")}
          </h1>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
          ) : !can("C") ? (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("workArea.noAccess")}
            </div>
          ) : form && containers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("wa.instanceNoContainers")}
            </p>
          ) : form ? (
            <InstanceForm
              form={form}
              setForm={setForm}
              projectId={projectId ?? ""}
              containers={containers}
              templates={templates}
              customTypes={customTypes}
              users={users}
              progressOptions={progressOptions}
              progressEnabled={progressWorkflow !== null}
              busy={busy}
              setBusy={setBusy}
              onSaved={(savedId) => {
                // Stay on the page: the form becomes the update form of
                // the newly created instance so the user can keep working
                // on it instead of being sent back to the workspace list.
                if (savedId) {
                  setForm((f) =>
                    f ? { ...f, mode: "update", id: savedId } : f
                  );
                } else {
                  navigate(workspaceBack);
                }
              }}
              onCancel={() => {
                navigate(workspaceBack);
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  );
};

export default WorkAreaInstanceNew;
