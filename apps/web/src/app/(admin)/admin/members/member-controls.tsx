"use client";

import { useActionState, useState } from "react";
import { Copy, Pencil, UserMinus, UserPlus, X } from "lucide-react";
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
import { CheckboxField, FormField, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import {
  deactivateMemberAction,
  inviteMemberAction,
  revokeInviteAction,
  setMemberRolesAction,
  type SettingsActionResult,
} from "../settings-actions";

type RoleOption = { id: string; name: string };

function RoleChecklist({ roles, selected }: { roles: RoleOption[]; selected: string[] }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">Roles</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((role) => (
          <CheckboxField key={role.id} name="roleIds" value={role.id} label={role.name} defaultChecked={selected.includes(role.id)} />
        ))}
      </div>
    </fieldset>
  );
}

export function InviteForm({
  organizationName,
  roles,
  defaultRoleId,
}: {
  organizationName: string;
  roles: RoleOption[];
  defaultRoleId: string;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: SettingsActionResult | null, formData: FormData) => inviteMemberAction(organizationName, formData),
    null,
  );
  return (
    <SectionCard title="Invite someone" description="They get an email with a link; they sign in with that address to join.">
      <form action={action} className="grid gap-4">
        <FormField label="Email" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" required placeholder="kollega@pelda.hu" className="max-w-md" />
        </FormField>
        <RoleChecklist roles={roles} selected={[defaultRoleId]} />
        {state?.inviteUrl ? (
          <Notice tone="warning">
            {state.message}
            <span className="mt-2 flex items-center gap-2">
              <code className="bg-background rounded px-2 py-1 font-mono text-xs break-all">{state.inviteUrl}</code>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Copy invite link"
                onClick={() => navigator.clipboard?.writeText(state.inviteUrl ?? "")}
              >
                <Copy />
              </Button>
            </span>
          </Notice>
        ) : (
          <ResultNotice result={state} />
        )}
        <div>
          <Button type="submit" disabled={pending}>
            <UserPlus /> {pending ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

export function MemberActions({
  membershipId,
  label,
  roles,
  roleIds,
}: {
  membershipId: string;
  label: string;
  roles: RoleOption[];
  roleIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [saved, save, saving] = useActionState(async (_prev: SettingsActionResult | null, formData: FormData) => {
    const result = await setMemberRolesAction(membershipId, formData);
    if (result.ok) setOpen(false);
    return result;
  }, null);
  const [removed, remove, removing] = useActionState(async () => deactivateMemberAction(membershipId), null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center justify-end gap-1">
      {removed && !removed.ok ? <span className="text-destructive text-xs">{removed.message}</span> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Pencil /> Roles
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roles for {label}</DialogTitle>
            <DialogDescription>Permissions from all ticked roles are combined.</DialogDescription>
          </DialogHeader>
          <form action={save} className="grid gap-4">
            <RoleChecklist roles={roles} selected={roleIds} />
            <ResultNotice result={saved} />
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save roles"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirming ? (
        <form action={remove} className="flex items-center gap-1">
          <Button type="submit" variant="destructive" size="sm" disabled={removing}>
            {removing ? "Removing…" : "Confirm remove"}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setConfirming(false)}>
            <X />
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
          <UserMinus /> Remove
        </Button>
      )}
    </div>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [state, action, pending] = useActionState(async () => revokeInviteAction(inviteId), null);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      {state && !state.ok ? <span className="text-destructive text-xs">{state.message}</span> : null}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        <X /> {pending ? "Revoking…" : "Revoke"}
      </Button>
    </form>
  );
}
