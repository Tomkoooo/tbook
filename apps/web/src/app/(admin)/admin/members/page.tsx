import { listInvites, listMembers, listRoles } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { InviteForm, MemberActions, RevokeInviteButton } from "./member-controls";
import { RoleDialog, DeleteRoleButton } from "./role-dialog";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const { organizationId, organizationName, permissions, user } = await requireAdminPage("member:read");
  const [members, roles, invites] = await Promise.all([
    listMembers(organizationId),
    listRoles(organizationId),
    permissions.has("member:invite") ? listInvites(organizationId) : Promise.resolve([]),
  ]);
  const roleOptions = roles.map((role) => ({ id: role.id, name: role.name }));
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const canManage = permissions.has("member:manage");
  const canManageRoles = permissions.has("role:manage");
  const defaultRoleId = roles.find((role) => role.isBuiltIn && role.name === "Viewer")?.id ?? roles[0]?.id ?? "";

  return (
    <>
      <PageTitle title="Team" description={`Who can work in ${organizationName}, and what each person may do.`} />

      {permissions.has("member:invite") ? (
        <InviteForm organizationName={organizationName} roles={roleOptions} defaultRoleId={defaultRoleId} />
      ) : null}

      <SectionCard title={`Members (${members.filter((m) => m.status === "active").length})`} flush>
        {members.length === 0 ? (
          <EmptyState title="No members yet" hint="Invite someone above." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.membershipId} className={member.status !== "active" ? "opacity-60" : undefined}>
                  <TableCell>
                    <div className="font-medium">{member.name || member.email}</div>
                    {member.name ? <div className="text-muted-foreground text-xs">{member.email}</div> : null}
                    {member.userId === user.id ? <Badge variant="outline" className="mt-1">you</Badge> : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap gap-1">
                      {member.roleIds.map((id) => (
                        <Badge key={id} variant={roleName.get(id) === "Owner" ? "info" : "neutral"}>
                          {roleName.get(id) ?? "Removed role"}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.status === "active" ? "success" : "neutral"}>{member.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {canManage && member.status === "active" && member.userId !== user.id ? (
                      <MemberActions
                        membershipId={member.membershipId}
                        label={member.name || member.email}
                        roles={roleOptions}
                        roleIds={member.roleIds}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {invites.length > 0 ? (
        <SectionCard title={`Pending invites (${invites.length})`} flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-medium">{invite.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {invite.roleIds.map((id) => (
                        <Badge key={String(id)} variant="neutral">
                          {roleName.get(String(id)) ?? "Removed role"}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(invite.expiresAt)}</TableCell>
                  <TableCell>
                    <RevokeInviteButton inviteId={invite.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}

      {permissions.has("role:read") ? (
        <SectionCard
          title="Roles"
          description="A role is a named set of permissions. Owner and Viewer are built in; their permissions can be adjusted but not their names."
          actions={canManageRoles ? <RoleDialog role={null} /> : null}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Permissions</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="whitespace-normal">
                    <div className="flex items-center gap-2 font-medium">
                      {role.name}
                      {role.isBuiltIn ? <Badge variant="outline">built-in</Badge> : null}
                    </div>
                    {role.description ? <div className="text-muted-foreground text-xs">{role.description}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">{role.permissions.length}</TableCell>
                  <TableCell className="text-right">
                    {members.filter((m) => m.status === "active" && m.roleIds.includes(role.id)).length}
                  </TableCell>
                  <TableCell>
                    {canManageRoles ? (
                      <div className="flex justify-end gap-1">
                        <RoleDialog
                          role={{
                            id: role.id,
                            name: role.name,
                            description: role.description ?? "",
                            permissions: [...role.permissions],
                            isBuiltIn: role.isBuiltIn,
                          }}
                        />
                        {!role.isBuiltIn ? <DeleteRoleButton roleId={role.id} /> : null}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}
    </>
  );
}
