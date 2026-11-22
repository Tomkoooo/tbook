import Link from "next/link";
import { organizationRepository } from "@tbook/db";
import { listModuleDefinitions } from "@tbook/services";
import { BookOpen, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { HELP_TOPICS, type HelpTopic } from "@/lib/help-topics";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";

export const dynamic = "force-dynamic";

/**
 * Súgó: the user guide, cut to what this organization has switched on and
 * what this member may do. Modules the organization doesn't have are
 * listed at the end, so people know they exist and whom to ask.
 */
export default async function HelpPage() {
  const { organizationId, permissions } = await requireAdminPage();
  const org = await organizationRepository.findById(organizationId);
  const granted = new Set(
    Object.entries((org?.modules ?? {}) as Record<string, { enabled?: boolean }>)
      .filter(([, state]) => state?.enabled)
      .map(([key]) => key),
  );
  const moduleNames = new Map(listModuleDefinitions().map((definition) => [definition.key, definition.name]));

  const allowed = (topic: HelpTopic) => !topic.permissions || topic.permissions.some((permission) => hasPermissionOrFallback(permissions, permission));
  const visible = HELP_TOPICS.filter((topic) => (!topic.module || granted.has(topic.module)) && allowed(topic));
  const notEnabled = HELP_TOPICS.filter((topic) => topic.module && !granted.has(topic.module));

  return (
    <>
      <PageTitle title="Súgó" description="Útmutató a szervezeted számára elérhető funkciókhoz. Csak az látszik, amit a szervezeted használ és amihez jogosultságod van." />

      {visible.length === 0 ? (
        <EmptyState variant="panel" icon={<BookOpen />} title="Nincs megjeleníthető súgó" hint="A szervezetednek bekapcsolt funkciókhoz és a jogosultságaidhoz nem tartozik útmutató." />
      ) : (
        <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <SectionCard title="Tartalom" icon={<BookOpen />} className="lg:sticky lg:top-20">
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {visible.map((topic) => (
                <li key={topic.id}>
                  <Link href={`#${topic.id}`} className="hover:bg-muted block rounded-md px-2 py-1.5 text-sm font-medium transition-colors">
                    {topic.title}
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>

          <div className="grid gap-4 md:gap-6">
            {visible.map((topic) => (
              <SectionCard
                key={topic.id}
                id={topic.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {topic.title}
                    {topic.module ? <Badge variant="neutral">{moduleNames.get(topic.module) ?? topic.module}</Badge> : null}
                  </span>
                }
                description={topic.summary}
                actions={
                  topic.links?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {topic.links.map((link) => (
                        <Button key={link.href} asChild variant="outline" size="sm">
                          <Link href={link.href}>{link.label}</Link>
                        </Button>
                      ))}
                    </div>
                  ) : undefined
                }
              >
                <div className="grid gap-5">
                  {topic.sections.map((section) => (
                    <div key={section.heading} className="grid gap-2">
                      <h3 className="font-medium">{section.heading}</h3>
                      {section.text?.map((paragraph) => (
                        <p key={paragraph} className="text-muted-foreground text-sm leading-6">
                          {paragraph}
                        </p>
                      ))}
                      {section.steps?.length ? (
                        <ol className="text-muted-foreground grid list-decimal gap-1 pl-5 text-sm leading-6">
                          {section.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  ))}
                </div>
              </SectionCard>
            ))}

            {notEnabled.length > 0 ? (
              <SectionCard title="Nem elérhető a szervezetednek" icon={<Lock />} description="Ezeket a funkciókat a tBook rendszergazdája kapcsolhatja be a szervezetednek.">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {notEnabled.map((topic) => (
                    <li key={topic.id}>
                      <p className="font-medium">{topic.title}</p>
                      <p className="text-muted-foreground text-sm">{topic.summary}</p>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
