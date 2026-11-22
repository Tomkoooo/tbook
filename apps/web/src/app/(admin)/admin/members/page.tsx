import { listInvites, listMembers, listRoles } from "@tbook/services";
import { MailPlus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { PageTitle } from "@/components/page-title";
import { Panel } from "@/components/panel";
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

  const activeMembers = members.filter((m) => m.status === "active");

  return (
    <>
      <PageTitle title="Team" description={`Who can work in ${organizationName}, and what each person may do.`} />

      <KpiGrid cols={3}>
        <KpiTile label="Active members" value={activeMembers.length} icon={<Users />} tone="success" />
        {permissions.has("member:invite") ? (
          <KpiTile label="Pending invites" value={invites.length} icon={<MailPlus />} tone={invites.length > 0 ? "warning" : "neutral"} />
        ) : null}
        {permissions.has("role:read") ? <KpiTile label="Roles" value={roles.length} icon={<ShieldCheck />} /> : null}
      </KpiGrid>

      {permissions.has("member:invite") ? (
        <InviteForm organizationName={organizationName} roles={roleOptions} defaultRoleId={defaultRoleId} />
      ) : null}

      <Panel title={`Members (${activeMembers.length})`} flush>
        <DataTable
          rows={members}
          rowKey={(member) => member.membershipId}
          mobileCards
          caption="Members"
          rowClassName={(member) => (member.status !== "active" ? "opacity-60" : undefined)}
          empty={
            <EmptyState icon={<UserPlus />} title="No members yet" hint={permissions.has("member:invite") ? "Invite someone above." : undefined} />
          }
          columns={[
            {
              key: "person",
              header: "Person",
              mobile: "title",
              cell: (member) => (
                <>
                  <div className="font-medium">{member.name || member.email}</div>
                  {member.name ? <div className="text-muted-foreground text-xs">{member.email}</div> : null}
                  {member.userId === user.id ? (
                    <Badge variant="outline" className="mt-1">
                      you
                    </Badge>
                  ) : null}
                </>
              ),
            },
            {
              key: "roles",
              header: "Roles",
              wrap: true,
              cell: (member) => (
                <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                  {member.roleIds.map((id) => (
                    <Badge key={id} variant={roleName.get(id) === "Owner" ? "info" : "neutral"}>
                      {roleName.get(id) ?? "Removed role"}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (member) => <Badge variant={member.status === "active" ? "success" : "neutral"}>{member.status}</Badge>,
            },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              mobile: "footer",
              cell: (member) =>
                canManage && member.status === "active" && member.userId !== user.id ? (
                  <MemberActions
                    membershipId={member.membershipId}
                    label={member.name || member.email}
                    roles={roleOptions}
                    roleIds={member.roleIds}
                  />
                ) : null,
            },
          ]}
        />
      </Panel>

      {invites.length > 0 ? (
        <Panel title={`Pending invites (${invites.length})`} flush>
          <DataTable
            rows={invites}
            rowKey={(invite) => invite.id}
            mobileCards
            caption="Pending invites"
            columns={[
              { key: "email", header: "Email", mobile: "title", cell: (invite) => <span className="font-medium">{invite.email}</span> },
              {
                key: "roles",
                header: "Roles",
                wrap: true,
                cell: (invite) => (
                  <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                    {invite.roleIds.map((id) => (
                      <Badge key={String(id)} variant="neutral">
                        {roleName.get(String(id)) ?? "Removed role"}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              { key: "expires", header: "Expires", className: "text-muted-foreground", cell: (invite) => formatDateTime(invite.expiresAt) },
              {
                key: "actions",
                header: <span className="sr-only">Actions</span>,
                mobile: "footer",
                cell: (invite) => <RevokeInviteButton inviteId={invite.id} />,
              },
            ]}
          />
        </Panel>
      ) : null}

      {permissions.has("role:read") ? (
        <Panel
          title="Roles"
          description="A role is a named set of permissions. Owner and Viewer are built in; their permissions can be adjusted but not their names."
          actions={canManageRoles ? <RoleDialog role={null} /> : null}
          flush
        >
          <DataTable
            rows={roles}
            rowKey={(role) => role.id}
            mobileCards
            caption="Roles"
            columns={[
              {
                key: "role",
                header: "Role",
                wrap: true,
                mobile: "title",
                cell: (role) => (
                  <>
                    <div className="flex items-center gap-2 font-medium">
                      {role.name}
                      {role.isBuiltIn ? <Badge variant="outline">built-in</Badge> : null}
                    </div>
                    {role.description ? <div className="text-muted-foreground text-xs">{role.description}</div> : null}
                  </>
                ),
              },
              { key: "permissions", header: "Permissions", align: "right", cell: (role) => role.permissions.length },
              {
                key: "members",
                header: "Members",
                align: "right",
                cell: (role) => activeMembers.filter((m) => m.roleIds.includes(role.id)).length,
              },
              {
                key: "actions",
                header: <span className="sr-only">Actions</span>,
                mobile: "footer",
                cell: (role) =>
                  canManageRoles ? (
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
                  ) : null,
              },
            ]}
          />
        </Panel>
      ) : null}
    </>
  );
}
