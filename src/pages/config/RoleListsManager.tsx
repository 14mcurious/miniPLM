import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Role, RoleList } from "@/lib/types";

const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";

/**
 * Manager for workflow role lists: create, edit, delete lists and assign roles.
 */
const RoleListsManager = () => {
  const { t } = useI18n();
  const [roleLists, setRoleLists] = useState<RoleList[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<RoleList | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const translate = (err: unknown): string => {
    if (err instanceof ApiError && err.serverKey) {
      return t(err.serverKey, err.serverParams ?? undefined);
    }
    return t("error.requestFailed", { status: "?" });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        roleLists: RoleList[];
        roles: Role[];
      }>(CUSTOM_TYPES_ENDPOINT);
      setRoleLists(data.roleLists ?? []);
      setRoles(data.roles ?? []);
    } catch (err) {
      setError(translate(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setName("");
    setSelectedRoles([]);
    setFormError(null);
  };

  const openEdit = (list: RoleList) => {
    setEditing(list);
    setCreating(false);
    setName(list.name);
    setSelectedRoles(list.members.map((m) => m.id));
    setFormError(null);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setFormError(t("ct.error.nameRequired"));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      let listId: number | undefined;
      if (creating) {
        const data = await api<{ roleListId: number }>(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "create-role-list",
            name: name.trim(),
          }),
        });
        listId = data.roleListId;
      } else if (editing) {
        const data = await api<{ roleListId: number }>(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "update-role-list",
            id: editing.id,
            name: name.trim(),
          }),
        });
        listId = data.roleListId;
      }
      if (listId !== undefined) {
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "set-role-list-members",
            id: listId,
            members: selectedRoles,
          }),
        });
        toast.success(editing ? t("ct.roleListSaved") : t("ct.roleListSaved"));
        closeForm();
        await load();
      }
    } catch (err) {
      setFormError(translate(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (list: RoleList) => {
    if (!window.confirm(t("ct.deleteRoleList"))) return;
    try {
      await api(CUSTOM_TYPES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "delete-role-list",
          id: list.id,
        }),
      });
      toast.success(t("ct.roleListDeleted"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  /** Export a single role list as a downloadable JSON file. */
  const exportRoleList = (list: RoleList) => {
    const payload = {
      app: "miniplm",
      resource: "role-list",
      exportedAt: new Date().toISOString(),
      roleList: {
        id: list.id,
        name: list.name,
        roles: list.members.map((m) => ({ id: m.id, name: m.name })),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const slug = list.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    anchor.download = `miniplm-role-list-${slug || list.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * Import a single role list from a JSON file (the exported format, or a
   * plain object with name and roles). The list is matched by name
   * (case-insensitive): created when missing, members updated when present.
   * Roles are resolved by name against the system roles.
   */
  const importRoleList = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm(t("ct.importRoleListConfirm"))) return;
    setImporting(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toast.error(t("ct.importRoleListInvalid"));
        return;
      }
      const src =
        parsed &&
        typeof parsed === "object" &&
        (parsed as { roleList?: unknown }).roleList !== undefined
          ? (parsed as { roleList: unknown }).roleList
          : parsed;
      if (!src || typeof src !== "object") {
        toast.error(t("ct.importRoleListInvalid"));
        return;
      }
      const it = src as { name?: unknown; roles?: unknown };
      const nm = typeof it.name === "string" ? it.name.trim() : "";
      if (!nm || nm.length > 100 || !Array.isArray(it.roles)) {
        toast.error(t("ct.importRoleListInvalid"));
        return;
      }
      // Resolve role names (case-insensitive) against the system roles.
      const byName = new Map(
        roles.map((r) => [r.name.toLowerCase(), r.id])
      );
      const roleIds = new Set<number>();
      const missing: string[] = [];
      for (const item of it.roles) {
        const rn =
          typeof item === "string"
            ? item.trim()
            : item &&
                typeof item === "object" &&
                typeof (item as { name?: unknown }).name === "string"
              ? ((item as { name: string }).name).trim()
              : "";
        if (!rn) {
          toast.error(t("ct.importRoleListInvalid"));
          return;
        }
        const rid = byName.get(rn.toLowerCase());
        if (rid === undefined) missing.push(rn);
        else roleIds.add(rid);
      }
      if (missing.length > 0) {
        toast.error(
          t("ct.importRoleListMissingRoles", {
            names: [...new Set(missing)].join(", "),
          })
        );
        return;
      }
      const members = [...roleIds];
      const existing = roleLists.find(
        (l) => l.name.toLowerCase() === nm.toLowerCase()
      );
      if (existing) {
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "set-role-list-members",
            id: existing.id,
            members,
          }),
        });
      } else {
        const res = await api<{ roleListId: number }>(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "create-role-list",
            name: nm,
          }),
        });
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "set-role-list-members",
            id: res.roleListId,
            members,
          }),
        });
      }
      toast.success(t("ct.importRoleListOk"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    } finally {
      setImporting(false);
    }
  };

  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t("ct.roleList")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={loading || importing || busy}
          >
            {t("ct.importRoleList")}
          </Button>
          <Button size="sm" onClick={openCreate} disabled={busy}>
            {t("ct.addRoleList")}
          </Button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        id="rolelist-import-file"
        name="roleListImportFile"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importRoleList(e)}
      />

      {(creating || editing) && (
        <form
          onSubmit={save}
          className="space-y-4 rounded-md border p-4"
        >
          <h3 className="text-base font-semibold text-foreground">
            {creating ? t("ct.addRoleList") : t("ct.editRoleList")}
          </h3>
          <div>
            <label htmlFor="rolelist-name" className={labelClass}>
              {t("ct.roleListName")}
            </label>
            <Input
              id="rolelist-name"
              name="rolelistName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <span className={labelClass}>{t("ct.roleListMembers")}</span>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-input bg-background p-2">
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                roles.map((role) => {
                  const checked = selectedRoles.includes(role.id);
                  return (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <input
                        type="checkbox"
                        id={`role-${role.id}`}
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selectedRoles, role.id]
                            : selectedRoles.filter((id) => id !== role.id);
                          setSelectedRoles(next);
                        }}
                        disabled={busy}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span>{role.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {t("configuration.save")}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              {t("wa.cancel")}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("wa.loading")}</p>
      ) : roleLists.length === 0 && !creating && !editing ? (
        <p className="text-sm text-muted-foreground">
          {t("ct.empty")}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2">{t("ct.roleListName")}</th>
              <th className="px-2 py-2">{t("ct.roleListMembers")}</th>
              <th className="px-2 py-2" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {roleLists.map((list) => (
              <tr key={list.id} className="border-b hover:bg-muted/40">
                <td className="px-2 py-2 font-medium text-foreground">
                  {list.name}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {list.members.length} {t("ct.roleListMembers")}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => exportRoleList(list)}
                    >
                      {t("ct.exportRoleList")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(list)}
                    >
                      {t("wa.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(list)}
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
  );
};

export default RoleListsManager;
