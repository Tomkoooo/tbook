import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, CalendarOff, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { SelectOrgForm } from "@/app/(admin)/admin/select-org/select-org-form";
import { hasAnyPermission } from "@/lib/nav-config";
import { HomeHeader } from "./home-header";
import { HomeEventCard } from "./event-card";
import { navIcon } from "./icons";
import type { HomeState } from "./load-home";

/** `/` for a signed-in user, in every state the account can be in. */
export function SignedInHome({ state, email, autoSelectFailed }: { state: HomeState; email: string | null; autoSelectFailed: boolean }) {
  switch (state.kind) {
    case "no-orgs":
      return (
        <Shell>
          <HomeHeader organizationName={null} email={email} canSwitchOrg={false} showConsole={false} />
          <SectionCard>
            <EmptyState
              icon={<Building2 />}
              title="No organization access"
              hint="Your account isn't a member of any organization yet. Ask an organizer to invite you, then reload this page."
            />
          </SectionCard>
        </Shell>
      );

    case "choose-org":
      return (
        <Shell>
          <HomeHeader organizationName={null} email={email} canSwitchOrg={false} showConsole={false} />
          <SectionCard title="Choose an organization" description="You belong to more than one. Everything here is shown for one at a time." flush>
            <SelectOrgForm organizations={state.organizations} next="/" />
          </SectionCard>
        </Shell>
      );

    case "auto-select":
      // Only reached when the automatic selection (/auth/pick-org) didn't stick, e.g. cookies are blocked.
      return (
        <Shell>
          <HomeHeader organizationName={null} email={email} canSwitchOrg={false} showConsole={false} />
          {autoSelectFailed ? <Notice tone="warning">We couldn&apos;t remember your organization automatically. Open it below.</Notice> : null}
          <SectionCard title="Open your organization" flush>
            <SelectOrgForm organizations={[state.organization]} next="/" />
          </SectionCard>
        </Shell>
      );

    case "system-no-org":
      return (
        <Shell>
          <HomeHeader organizationName={null} email={email} canSwitchOrg={false} showConsole={false} />
          <SectionCard title="Platform administrator" description="Pick an organization to work in, or manage all of them.">
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/admin/select-org">
                  <Building2 /> Select organization
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/admin/organizations">All organizations</Link>
              </Button>
            </div>
          </SectionCard>
        </Shell>
      );

    case "ready": {
      const granted = new Set(state.permissions);
      const canOpenEvent = hasAnyPermission(granted, "event:read");
      const live = state.mode === "today";
      return (
        <Shell>
          <HomeHeader organizationName={state.organizationName} email={email} canSwitchOrg={state.canSwitchOrg} />

          <section aria-labelledby="home-today" className="grid gap-3">
            <h2 id="home-today" className="text-base font-semibold">
              {live ? "Today" : "Coming up"}
            </h2>
            {state.eventsFailed ? <Notice tone="danger">The events couldn&apos;t be loaded. Reload the page, or open the admin console.</Notice> : null}
            {state.mode === "upcoming" ? <Notice>Nothing is happening today. These events are next.</Notice> : null}
            {state.events.map((event) => (
              <HomeEventCard key={event.id} event={event} live={live} canOpenEvent={canOpenEvent} />
            ))}
            {state.mode === "none" && !state.eventsFailed ? (
              <SectionCard>
                <EmptyState
                  icon={<CalendarOff />}
                  title="No events today and none coming up"
                  hint="Active events show up here on the day. Draft and archived events are hidden."
                  action={
                    canOpenEvent ? (
                      <Button variant="outline" asChild>
                        <Link href="/admin/events">All events</Link>
                      </Button>
                    ) : null
                  }
                />
              </SectionCard>
            ) : null}
          </section>

          <SectionCard title="Everything else" description="The rest of the console that your role can open.">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {state.orgLinks.map((item) => {
                const Icon = navIcon(item.icon);
                return (
                  <Button key={item.href} variant="outline" className="justify-start" asChild>
                    <Link href={item.href}>
                      <Icon /> {item.label}
                    </Link>
                  </Button>
                );
              })}
              <Button className="justify-start" asChild>
                <Link href="/admin">
                  <LayoutDashboard /> Open admin console
                </Link>
              </Button>
            </div>
          </SectionCard>
        </Shell>
      );
    }
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background min-h-svh">
      <Container width="default" className="p-4 pb-16 md:p-6">
        {children}
      </Container>
    </main>
  );
}
