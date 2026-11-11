import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { expandLegacyEligibilityForEdit } from "@tbook/domain";
import {
  describeDayPassAvailability,
  extensions,
  getEventForOrg,
  getOrganizationSettings,
  listDataListsForOrg,
  listGroupsForOrg,
  listModuleDefinitions,
  resolveModules,
} from "@tbook/services";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage, toDateInput, toDateTimeInput } from "@/lib/admin-page";
import { EMPTY_DAY_PASS, EMPTY_ELIGIBILITY, EventForm, type EventFormValues } from "./event-form";
import { DayAvailabilityTable } from "./day-availability-table";
import { EventModulesCard } from "./event-modules-card";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const isNew = eventId === "new";
  const { organizationId, permissions } = await requireAdminPage(isNew ? "event:write" : "event:read");

  const groups = (await listGroupsForOrg(organizationId)).map((group) => ({ id: String(group._id), name: group.name }));

  if (isNew) {
    const today = toDateInput(new Date());
    const { currency: orgCurrency } = await getOrganizationSettings(organizationId);
    const initial: EventFormValues = {
      kind: "standard",
      dayPass: EMPTY_DAY_PASS,
      groupId: groups[0]?.id ?? "",
      name: "",
      description: "",
      address: "",
      startDate: today,
      endDate: today,
      startTime: "",
      endTime: "",
      salesOpensAt: "",
      salesClosesAt: "",
      currency: orgCurrency,
      ticketFeeHuf: 0,
      ticketFeeMode: "per_person",
      registrationUnit: "person",
      playersPerTicket: 1,
      ticketPriceBasis: "net",
      ticketVatPercent: 27,
      capacity: null,
      vouchersEnabled: true,
      publicListing: "listed",
      status: "draft",
      tdartsEnabled: false,
      tdartsTournamentCode: "",
      attendeeFieldSchema: [],
      attendeeFieldSchemaMode: "extend",
      eligibility: EMPTY_ELIGIBILITY,
      pricingRules: [],
    };
    return (
      <>
        <PageTitle title="New event" />
        <EventForm eventId={null} initial={initial} groups={groups} />
      </>
    );
  }

  const event = await getEventForOrg(organizationId, eventId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!event) notFound();

  if (!permissions.has("event:write")) {
    return <PageTitle title={event.name} description="You have read-only access to this event." />;
  }

  const modules = await resolveModules({ organizationId, event });
  const choiceSources = extensions
    .choiceProviders()
    .filter((provider) => modules.isOn(provider.moduleKey))
    .map((provider) => ({ key: provider.key, label: provider.label }));
  const dataLists = (await listDataListsForOrg(organizationId)).map((list) => ({ id: String(list._id), name: `${list.name} (${list.rowCount})` }));
  const entitled = await resolveModules({ organizationId });
  const moduleRows = listModuleDefinitions()
    .filter((definition) => definition.scopes.includes("event") && entitled.isOn(definition.key))
    .map((definition) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      on: modules.isOn(definition.key),
      configFields: (definition.configFields ?? []).map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
      config: Object.fromEntries(Object.entries(modules.config(definition.key)).map(([k, v]) => [k, String(v ?? "")])),
    }));

  const eligibility = expandLegacyEligibilityForEdit(event);
  const formRules = event.eligibilityFormRules;

  return (
    <>
      <PageTitle title={event.name} />
      {moduleRows.length > 0 ? <EventModulesCard eventId={eventId} modules={moduleRows} canManage={permissions.has("module:manage")} /> : null}
      <EventForm
        eventId={eventId}
        groups={groups}
        soldGuestCount={event.soldGuestCount}
        choiceSources={choiceSources}
        dataLists={dataLists}
        initial={{
          kind: event.kind ?? "standard",
          dayPass: event.dayPass
            ? {
                weekdayPriceHuf: event.dayPass.weekdayPriceHuf,
                weekendPriceHuf: event.dayPass.weekendPriceHuf,
                weekendDays: [...event.dayPass.weekendDays],
                dailyCapacity: event.dayPass.dailyCapacity ?? null,
                capacityOverrides: Object.entries((event.dayPass.capacityOverrides ?? {}) as Record<string, number>).map(([date, capacity]) => ({ date, capacity })),
                closedDays: [...event.dayPass.closedDays].join(", "),
                weekdayOpenTime: event.dayPass.weekdaySchedule?.openTime ?? "",
                weekdayCloseTime: event.dayPass.weekdaySchedule?.closeTime ?? "",
                weekendOpenTime: event.dayPass.weekendSchedule?.openTime ?? "",
                weekendCloseTime: event.dayPass.weekendSchedule?.closeTime ?? "",
                discountCodes: (event.dayPass.discountCodes ?? []).map((entry) => ({
                  code: entry.code,
                  label: entry.label ?? "",
                  percentOff: entry.percentOff,
                  enabled: entry.enabled ?? true,
                })),
              }
            : EMPTY_DAY_PASS,
          groupId: event.groupId ? String(event.groupId) : "",
          name: event.name,
          description: event.description ?? "",
          address: event.location?.address ?? "",
          startDate: toDateInput(event.startDate),
          endDate: toDateInput(event.endDate),
          startTime: event.startTime ?? "",
          endTime: event.endTime ?? "",
          salesOpensAt: toDateTimeInput(event.salesOpensAt),
          salesClosesAt: toDateTimeInput(event.salesClosesAt),
          currency: event.currency,
          ticketFeeHuf: event.ticketFeeHuf,
          ticketFeeMode: event.ticketFeeMode,
          registrationUnit: event.registrationUnit,
          playersPerTicket: event.playersPerTicket,
          ticketPriceBasis: event.ticketPriceBasis,
          ticketVatPercent: event.ticketVatPercent,
          capacity: event.capacity,
          vouchersEnabled: event.vouchersEnabled,
          publicListing: event.publicListing,
          status: event.status,
          tdartsEnabled: event.tdarts?.enabled ?? false,
          tdartsTournamentCode: event.tdarts?.tournamentCode ?? "",
          attendeeFieldSchema: [...(event.attendeeFieldSchema ?? [])]
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((field) => ({
              key: field.key,
              label: field.label,
              type: field.type,
              required: field.required ?? false,
              helpText: field.helpText ?? "",
              choices: field.choices?.map((choice) => ({ value: choice.value, label: choice.label })),
              choicesSource: field.choicesSource ?? null,
              showWhen: field.showWhen ? { fieldKey: field.showWhen.fieldKey, values: [...field.showWhen.values] } : null,
              unique: field.unique ?? false,
              identifier: field.identifier ?? false,
            })),
          attendeeFieldSchemaMode: event.attendeeFieldSchemaMode ?? "extend",
          eligibility: {
            preset: eligibility.eligibilityPreset,
            minAge: eligibility.eligibilityMinAge ?? "",
            maxAge: eligibility.eligibilityMaxAge ?? "",
            genders: eligibility.eligibilityAllowedGenders ?? [],
            birthDateFieldKey: event.eligibilityBirthDateFieldKey ?? "",
            genderFieldKey: event.eligibilityGenderFieldKey ?? "",
            logic: formRules?.logic ?? "and",
            rules: (formRules?.rules ?? []).map((rule) => ({
              id: rule.id,
              fieldKey: rule.fieldKey,
              op: rule.op,
              value: rule.value ?? "",
              message: rule.message ?? "",
            })),
          },
          pricingRules: (event.pricingRules ?? []).map((rule) => ({
            id: rule.id,
            enabled: rule.enabled ?? true,
            label: rule.label,
            when: rule.when,
            action: rule.action,
            amount: rule.amount ?? 0,
            amountMode: rule.amountMode ?? "fixed",
          })),
        }}
      />
      <DayAvailabilityTable days={describeDayPassAvailability(event)} currency={event.currency} />
    </>
  );
}
