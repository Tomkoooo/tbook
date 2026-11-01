import Link from "next/link";
import { organizationRepository } from "@tbook/db";
import { listOrganizationsForUser } from "@tbook/services";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
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
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageTitle
        title="Select an organization"
        description="Everything in the console is scoped to one organization at a time."
        actions={
          user.isSystemAdmin ? (
            <Button variant="outline" asChild>
              <Link href="/admin/organizations">
                <Plus /> New organization
              </Link>
            </Button>
          ) : null
        }
      />

      {error === "no-access" ? (
        <Notice tone="warning">You no longer have access to the previously selected organization. Pick another one.</Notice>
      ) : null}

      <SectionCard flush>
        {organizations.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            You aren&apos;t a member of any organization yet. Ask an org admin to invite you, then reload this page.
          </p>
        ) : (
          <SelectOrgForm organizations={organizations} />
        )}
      </SectionCard>

      <p className="text-muted-foreground text-sm">
        Signed in as {user.email}.{" "}
        <Link className="text-primary hover:underline" href="/api/auth/signout">
          Sign out
        </Link>
      </p>
    </div>
  );
}
