"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { PERMISSION_GROUPS } from "@/lib/permission-labels";
import { ROLE_TEMPLATES } from "@/lib/role-templates";
import { deleteRoleAction, saveRoleAction, type SettingsActionResult } from "../settings-actions";

interface RoleValues {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isBuiltIn: boolean;
}

/** Create (role = null) or edit a role: name, description and grouped permission checkboxes. */
export function RoleDialog({ role }: { role: RoleValues | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [granted, setGranted] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const applyTemplate = (key: string) => {
    const template = ROLE_TEMPLATES.find((t) => t.key === key);
    if (!template) return;
    if (!role?.isBuiltIn) setName(template.name);
    setDescription(template.description);
    setGranted(new Set(template.permissions));
  };
  const toggle = (permission: string, on: boolean) =>
    setGranted((current) => {
      const next = new Set(current);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });
  const [state, action, pending] = useActionState(async (_prev: SettingsActionResult | null, formData: FormData) => {
    const result = await saveRoleAction(role?.id ?? null, formData);
    if (result.ok) setOpen(false);
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {role ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus /> New role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>Members with this role get exactly the permissions ticked below.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {role?.isBuiltIn ? null : (
            <FormField label="Start from a template" htmlFor="role-template" hint="Fills in the name and the permissions for a typical job. You can change everything afterwards.">
              <NativeSelect id="role-template" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">—</option>
                {ROLE_TEMPLATES.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.name} — {template.description}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="role-name" hint={role?.isBuiltIn ? "Built-in role names can't be changed." : undefined}>
              <Input id="role-name" name="name" value={name} onChange={(e) => setName(e.target.value)} readOnly={role?.isBuiltIn} required placeholder="Door staff" />
            </FormField>
            <FormField label="Description" htmlFor="role-description">
              <Input id="role-description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scans tickets at the entrance" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PERMISSION_GROUPS.map((group) => (
              <fieldset key={group.label} className="grid content-start gap-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{group.label}</legend>
                {group.permissions.map((permission) => (
                  <CheckboxField
                    key={permission.key}
                    name="permissions"
                    value={permission.key}
                    label={permission.label}
                    checked={granted.has(permission.key)}
                    onCheckedChange={(on) => toggle(permission.key, on)}
                  />
                ))}
              </fieldset>
            ))}
          </div>
          <ResultNotice result={state} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : role ? "Save role" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRoleButton({ roleId }: { roleId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(async () => deleteRoleAction(roleId), null);
  return (
    <div className="flex items-center gap-1">
      {state && !state.ok ? <span className="text-destructive max-w-48 text-xs">{state.message}</span> : null}
      {confirming ? (
        <form action={action} className="flex items-center gap-1">
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            {pending ? "Deleting…" : "Confirm delete"}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setConfirming(false)}>
            <X />
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="icon-sm" aria-label="Delete role" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}
