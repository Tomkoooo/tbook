import Link from "next/link";
import { organizationRepository } from "@tbook/db";
import { listOrganizationsForUser } from "@tbook/services";
import { Card, Notice, PageHeader } from "@tbook/ui";
import { getSessionUser } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { SelectOrgForm } from "./select-org-form";

/**
 * Org picker (legacy: TBookAdminHomeResolver's org-selection step). Lives
 * under /admin but is deliberately not org-gated — it is what a user
 * reaches when they have no active org yet.
 */
export const dynamic = "force-dynamic";

export default async function SelectOrgPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/signin?callbackUrl=/admin/select-org");

  const { error } = await searchParams;

  // A system admin may hold no membership anywhere, yet still needs to be
  // able to enter a tenant's console to support it.
  const organizations = user.isSystemAdmin
    ? (await organizationRepository.listAll()).map((org) => ({ id: String(org._id), name: org.name, slug: org.slug }))
    : await listOrganizationsForUser(user.id);

  return (
    <>
      <PageHeader
        title="Select an organization"
        description="Everything in the console is scoped to one organization at a time."
      />

      {error === "no-access" ? (
        <Notice tone="warning">
          You no longer have access to the previously selected organization. Pick another one.
        </Notice>
      ) : null}

      <Card>
        {organizations.length === 0 ? (
          <p className="tbook-muted">
            You aren&apos;t a member of any organization yet. Ask an org admin to invite you, then reload this page.
          </p>
        ) : (
          <SelectOrgForm organizations={organizations} />
        )}
      </Card>

      <p className="tbook-faint">
        Signed in as {user.email}. <Link href="/api/auth/signout">Sign out</Link>
      </p>
    </>
  );
}
