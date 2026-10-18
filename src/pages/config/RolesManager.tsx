import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Role, UserRef } from "@/lib/types";

const CUSTOM_TYPES_ENDPOINT = "/api/my/v1/custom-types";

/**
 * Manager for workflow roles: create, edit, delete roles and assign users.
 */
const RolesManager = () => {
  const { t } = useI18n();
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
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
        roles: Role[];
      }>(CUSTOM_TYPES_ENDPOINT);
      setRoles(data.roles ?? []);
      // Get all users for the member selection
      const usersData = await api<{
        users: UserRef[];
      }>("/api/my/v1/users", {
        method: "POST",
        body: JSON.stringify({ operation: "list" }),
      });
      setUsers(usersData.users ?? []);
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
    setSelectedUsers([]);
    setFormError(null);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setCreating(false);
    setName(role.name);
    setSelectedUsers(role.members.map((m) => m.id!));
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
      let roleId: number | undefined;
      if (creating) {
        const data = await api<{ roleId: number }>(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "create-role",
            name: name.trim(),
          }),
        });
        roleId = data.roleId;
      } else if (editing) {
        const data = await api<{ roleId: number }>(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "update-role",
            id: editing.id,
            name: name.trim(),
          }),
        });
        roleId = data.roleId;
      }
      if (roleId !== undefined) {
        await api(CUSTOM_TYPES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            operation: "set-role-members",
            id: roleId,
            members: selectedUsers,
          }),
        });
        toast.success(editing ? t("ct.roleSaved") : t("ct.roleSaved"));
        closeForm();
        await load();
      }
    } catch (err) {
      setFormError(translate(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (role: Role) => {
    if (!window.confirm(t("ct.deleteRole"))) return;
    try {
      await api(CUSTOM_TYPES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          operation: "delete-role",
          id: role.id,
        }),
      });
      toast.success(t("ct.roleDeleted"));
      await load();
    } catch (err) {
      toast.error(translate(err));
    }
  };

  const ROLE_NAME_RE = /^[A-Za-z][A-Za-z0-9 ]{0,49}$/;

  /** Export all roles as a downloadable JSON file. */
  const exportRoles = async () => {
    try {
      const data = await api<{ roles: Role[] }>(CUSTOM_TYPES_ENDPOINT);
      const payload = {
        app: "miniplm",
        resource: "roles",
        exportedAt: new Date().toISOString(),
        roles: (data.roles ?? []).map((role) => ({
          id: role.id,
          name: role.name,
          members: role.members
            .map((m) => m.id)
            .filter((id): id is number => id !== undefined),
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `miniplm-roles-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(translate(err));
    }
  };

  /**
   * Import roles from a JSON file (array of roles, or an object with a
   * "roles" array). Missing roles are created; members of existing roles
   * (matched by name, case-insensitive) are updated.
   */
  const importRoles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm(t("ct.importRolesConfirm"))) return;
    setImporting(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toast.error(t("ct.importRolesInvalid"));
        return;
      }
      const rawRoles = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { roles?: unknown[] }).roles)
          ? (parsed as { roles: unknown[] }).roles
          : null;
      if (!rawRoles) {
        toast.error(t("ct.importRolesInvalid"));
        return;
      }
      // Normalize and validate; duplicate names keep the last occurrence.
      const byName = new Map<string, { name: string; members: number[] }>();
      for (const item of rawRoles) {
        if (!item || typeof item !== "object") {
          toast.error(t("ct.importRolesInvalid"));
          return;
        }
        const it = item as { name?: unknown; members?: unknown };
        const nm = typeof it.name === "string" ? it.name.trim() : "";
        if (!nm || !ROLE_NAME_RE.test(nm)) {
          toast.error(t("ct.importRolesInvalid"));
          return;
        }
        if (!Array.isArray(it.members)) {
          toast.error(t("ct.importRolesInvalid"));
          return;
        }
        const members: number[] = [];
        for (const m of it.members) {
          if (typeof m !== "number" || !Number.isInteger(m)) {
            toast.error(t("ct.importRolesInvalid"));
            return;
          }
          members.push(m);
        }
        byName.set(nm.toLowerCase(), { name: nm, members });
      }
      const imported = [...byName.values()];
      const knownUserIds = new Set(
        users
          .map((u) => u.id)
          .filter((id): id is number => id !== undefined)
      );
      const unknown = [
        ...new Set(imported.flatMap((r) => r.members)),
      ].filter((id) => !knownUserIds.has(id));
      if (unknown.length > 0) {
        toast.error(
          t("ct.importRolesUnknownUser", { ids: unknown.join(", ") })
        );
        return;
      }
      let created = 0;
      let updated = 0;
      for (const role of imported) {
        const existing = roles.find(
          (r) => r.name.toLowerCase() === role.name.toLowerCase()
        );
        if (existing) {
          await api(CUSTOM_TYPES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "set-role-members",
              id: existing.id,
              members: role.members,
            }),
          });
          updated += 1;
        } else {
          const res = await api<{ roleId: number }>(CUSTOM_TYPES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "create-role",
              name: role.name,
            }),
          });
          await api(CUSTOM_TYPES_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({
              operation: "set-role-members",
              id: res.roleId,
              members: role.members,
            }),
          });
          created += 1;
        }
      }
      toast.success(t("ct.importRolesOk", { created, updated }));
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
          {t("ct.roles")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportRoles()}
            disabled={loading || importing}
          >
            {t("ct.exportRoles")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={loading || importing || busy}
          >
            {t("ct.importRoles")}
          </Button>
          <Button size="sm" onClick={openCreate} disabled={busy}>
            {t("ct.addRole")}
          </Button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        id="roles-import-file"
        name="rolesImportFile"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importRoles(e)}
      />

      {(creating || editing) && (
        <form
          onSubmit={save}
          className="space-y-4 rounded-md border p-4"
        >
          <h3 className="text-base font-semibold text-foreground">
            {creating ? t("ct.addRole") : t("ct.editRole")}
          </h3>
          <div>
            <label htmlFor="role-name" className={labelClass}>
              {t("ct.roleName")}
            </label>
            <Input
              id="role-name"
              name="roleName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <span className={labelClass}>{t("ct.roleMembers")}</span>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-input bg-background p-2">
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                users.map((user) => {
                  const checked = selectedUsers.includes(user.id!);
                  return (
                    <label
                      key={user.id}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <input
                        type="checkbox"
                        id={`user-${user.id}`}
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selectedUsers, user.id!]
                            : selectedUsers.filter((id) => id !== user.id);
                          setSelectedUsers(next);
                        }}
                        disabled={busy}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span>
                        {user.name} {user.surname} ({user.loginName})
                      </span>
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
      ) : roles.length === 0 && !creating && !editing ? (
        <p className="text-sm text-muted-foreground">
          {t("ct.empty")}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2">{t("ct.roleName")}</th>
              <th className="px-2 py-2">{t("ct.roleMembers")}</th>
              <th className="px-2 py-2" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="border-b hover:bg-muted/40">
                <td className="px-2 py-2 font-medium text-foreground">
                  {role.name}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {role.members.length} {t("ct.roleMembers")}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(role)}
                    >
                      {t("wa.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(role)}
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

export default RolesManager;
