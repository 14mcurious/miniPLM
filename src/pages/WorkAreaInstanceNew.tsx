import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import BackLink from "@/components/BackLink";
import InstanceForm from "@/components/InstanceForm";
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
    if (!projectId || !workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [instancesData, containersData, templatesData, customTypesData] =
        await Promise.all([
          api<{
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
      setProgressOptions(instancesData.progressOptions ?? []);
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

  return (
    <>
      <BackLink to={workspaceBack} label={t("wa.workspaces")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-4xl">
          <h1 className="mb-6 text-3xl font-bold tracking-tight text-foreground">
            {t("wa.newInstanceTitle")}
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
              busy={busy}
              setBusy={setBusy}
              onSaved={() => {
                navigate(workspaceBack);
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
