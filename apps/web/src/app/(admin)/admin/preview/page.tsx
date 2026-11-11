import Link from "next/link";
import { Eye } from "lucide-react";
import { voucherRepository } from "@tbook/db";
import { eventDayKeys, todayDayKey } from "@tbook/domain";
import { BUS_TRANSPORT, FEEDBACK, GUEST_PORTAL, busTransport, feedback } from "@tbook/modules";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { listEventsForOrg, liveFieldSchemaForEvent, registrationPrefillSetup, resolveModules } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { EventPicker } from "@/components/event-picker";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { SurveyForm } from "@/components/feedback/survey-form";
import { requireAdminPage } from "@/lib/admin-page";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { PassengerList } from "../bus/passenger-list";
import { ScanPanel } from "../check-in/[eventId]/scan-panel";
import { previewNoSaveAction, previewScanAction } from "./actions";
import { GuestPreview } from "./guest-preview";
import { RegistrationPreview } from "./registration-preview";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "form", label: "Regisztrációs űrlap" },
  { key: "captain", label: "Buszkapitány", module: BUS_TRANSPORT },
  { key: "checkin", label: "Beléptető" },
  { key: "guest", label: "Vendég nézet", module: GUEST_PORTAL },
  { key: "kiosk", label: "Kioszk és kérdőív", module: FEEDBACK },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

/**
 * Try what each person will see — the guest filling in the form through
 * the API, a bus captain, the door staff, a guest in self-service, a kiosk
 * — against the event's real setup. Nothing here writes.
 */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ eventId?: string; view?: string; routeId?: string; surveyId?: string }> }) {
  const params = await searchParams;
  const { organizationId, permissions } = await requireAdminPage("event:read");
  const events = await listEventsForOrg(organizationId);
  const event = events.find((e) => String(e._id) === params.eventId) ?? events[0] ?? null;

  if (!event) {
    return (
      <>
        <PageTitle title="Preview" />
        <SectionCard>
          <EmptyState icon={<Eye />} title="No events yet" hint="Create an event first; then try its form and views here." />
        </SectionCard>
      </>
    );
  }

  const eventId = String(event._id);
  const modules = await resolveModules({ organizationId, event });
  const views = VIEWS.filter((view) => !("module" in view) || modules.isOn(view.module));
  const view: ViewKey = views.some((v) => v.key === params.view) ? (params.view as ViewKey) : "form";
  const href = (key: string, extra = "") => `/admin/preview?eventId=${eventId}&view=${key}${extra}`;
  const canSeeGuests = hasPermissionOrFallback(permissions, "voucher:read");

  return (
    <>
      <PageTitle
        title="Preview"
        description="Próbáld ki az esemény valódi beállításaival, mit lát a vendég, a buszkapitány, a beléptető és a kioszk. Itt semmi nem mentődik."
        actions={events.length > 1 ? <EventPicker basePath={`/admin/preview?view=${view}`} events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
      />
      <nav className="flex flex-wrap gap-2" aria-label="Preview views">
        {views.map((item) => (
          <Button key={item.key} asChild size="sm" variant={item.key === view ? "default" : "outline"}>
            <Link href={href(item.key)}>{item.label}</Link>
          </Button>
        ))}
      </nav>
      {event.status !== "active" ? <Notice tone="info">Az esemény még nem aktív, ezért a weboldalon még nem jelenik meg. Az előnézet így is működik.</Notice> : null}

      {view === "form" ? await FormView(eventId, event) : null}
      {view === "captain" ? await CaptainView(eventId, params.routeId, href) : null}
      {view === "checkin" ? await CheckInView(eventId, event, canSeeGuests) : null}
      {view === "guest" ? <GuestPreview eventId={eventId} /> : null}
      {view === "kiosk" ? await KioskView(eventId, params.surveyId, href) : null}
    </>
  );
}

type EventDoc = Awaited<ReturnType<typeof listEventsForOrg>>[number];

async function FormView(eventId: string, event: EventDoc) {
  const stored = [...(event.attendeeFieldSchema ?? [])]
    .map((field) => (typeof (field as { toObject?: () => AttendeeFieldDef }).toObject === "function" ? (field as unknown as { toObject: () => AttendeeFieldDef }).toObject() : (field as AttendeeFieldDef)))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const live = await liveFieldSchemaForEvent(eventId, stored);
  const setup = registrationPrefillSetup(event as never);
  // Client props must be plain JSON.
  const fields = JSON.parse(JSON.stringify(live)) as AttendeeFieldDef[];
  return (
    <>
      {setup ? null : (
        <Notice tone="info">
          Ennél az eseménynél az űrlap nem azonosítóval kezdődik. Bekapcsolásához: azonosító kérdés „Identifies the guest” jelöléssel, rajta „is in list” szabály, a többi kérdésnél pedig „Prefill from data list column”.
        </Notice>
      )}
      <RegistrationPreview eventId={eventId} fields={fields} prefill={setup ? { fieldKey: setup.fieldKey, label: setup.label, helpText: setup.helpText } : null} />
    </>
  );
}

async function CaptainView(eventId: string, routeId: string | undefined, href: (key: string, extra?: string) => string) {
  const routes = await busTransport.listRoutes(eventId);
  if (routes.length === 0) {
    return (
      <SectionCard>
        <EmptyState title="Még nincs busz" hint="Vegyél fel járatot a Buszok menüben, vagy importáld táblázatból." />
      </SectionCard>
    );
  }
  const route = routes.find((r) => String(r._id) === routeId) ?? routes[0]!;
  const passengers = await busTransport.listPassengers(route);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {routes.map((r) => (
          <Button key={String(r._id)} asChild size="sm" variant={String(r._id) === String(route._id) ? "secondary" : "ghost"}>
            <Link href={href("captain", `&routeId=${String(r._id)}`)}>
              {r.code} · {r.city}
            </Link>
          </Button>
        ))}
      </div>
      <Notice tone="info">Ezt látja a buszkapitány a telefonján (linkről vagy „Buszkapitány” szerepkörrel). Előnézet: a jelölések nem mentődnek.</Notice>
      <div className="mx-auto grid w-full max-w-2xl gap-4 rounded-xl border p-4">
        <header className="grid gap-1">
          <h2 className="text-2xl font-semibold">
            {route.code} · {route.city}
          </h2>
          <p className="text-muted-foreground text-sm">
            {[route.pickupPoint, busTransport.formatDeparture(route.departureAt)].filter(Boolean).join(" · ")}
            {route.returnInfo ? ` · vissza: ${route.returnInfo}` : ""}
          </p>
        </header>
        <PassengerList
          lang="hu"
          passengers={passengers.map((p) => ({ attendeeKey: p.attendeeKey, name: p.name, registrationNumber: p.registrationNumber, phone: p.phone, outbound: p.outbound, return: p.return }))}
          onSet={previewNoSaveAction}
        />
      </div>
    </>
  );
}

async function CheckInView(eventId: string, event: EventDoc, canSeeGuests: boolean) {
  const days = event.kind === "day_pass" ? eventDayKeys(event.startDate, event.endDate) : [];
  const samples = canSeeGuests ? await voucherRepository.listByEvent(eventId, {}, { limit: 5 }) : [];
  return (
    <>
      <Notice tone="info">Ezt látja a beléptető. Előnézet: a beolvasás csak lekérdezés, senkit nem léptet be.</Notice>
      <ScanPanel eventId={eventId} today={todayDayKey(new Date())} days={days} scan={previewScanAction} />
      {samples.length > 0 ? (
        <SectionCard title="Kipróbálható kódok" description="Az első néhány belépő regisztrációs száma.">
          <ul className="grid gap-1 text-sm">
            {samples.map((voucher) => (
              <li key={String(voucher._id)}>
                <span className="font-mono">{voucher.registrationNumber ?? "—"}</span> · {voucher.displayName}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </>
  );
}

async function KioskView(eventId: string, surveyId: string | undefined, href: (key: string, extra?: string) => string) {
  const surveys = await feedback.listSurveys(eventId);
  if (surveys.length === 0) {
    return (
      <SectionCard>
        <EmptyState title="Még nincs kérdőív vagy kioszk" hint="Hozz létre egyet a Visszajelzés menüben." />
      </SectionCard>
    );
  }
  const survey = surveys.find((s) => String(s._id) === surveyId) ?? surveys[0]!;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {surveys.map((s) => (
          <Button key={String(s._id)} asChild size="sm" variant={String(s._id) === String(survey._id) ? "secondary" : "ghost"}>
            <Link href={href("kiosk", `&surveyId=${String(s._id)}`)}>
              {s.kind === "kiosk" ? "Kioszk" : "Kérdőív"}: {s.title}
            </Link>
          </Button>
        ))}
      </div>
      <Notice tone="info">
        {survey.kind === "kiosk" ? "Így néz ki a kioszk a tableten." : "Így néz ki a kérdőív a vendégnek (személyes linkkel)."} Előnézet: a válaszok nem kerülnek az eredmények közé.
      </Notice>
      <div className="mx-auto grid w-full max-w-3xl gap-6 rounded-xl border p-6">
        <header className="grid gap-2 text-center">
          <h2 className="text-3xl font-semibold">{survey.title}</h2>
          {survey.intro ? <p className="text-muted-foreground text-lg whitespace-pre-line">{survey.intro}</p> : null}
        </header>
        <SurveyForm
          questions={survey.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: q.required, choices: [...q.choices] }))}
          ratingMax={feedback.RATING_MAX}
          mode={survey.kind === "kiosk" ? "kiosk" : "survey"}
          needsCode={false}
          thankYou={survey.thankYou}
          submit={previewNoSaveAction}
        />
      </div>
    </>
  );
}
