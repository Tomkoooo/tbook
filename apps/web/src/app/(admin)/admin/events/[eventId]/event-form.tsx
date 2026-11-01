"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Megaphone,
  Plus,
  Scale,
  Ticket,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, NativeSelect, ResultNotice, StatusSelect } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { cn } from "@/lib/utils";
import { saveEventAction, type CatalogActionResult } from "../../catalog-actions";
import {
  RegistrationFieldsEditor,
  effectiveFieldKeys,
  fieldRowsFromDefs,
  serializeFieldRows,
  type FieldRow,
} from "./registration-fields-editor";
import {
  EligibilityEditor,
  PricingRulesEditor,
  newRuleUid,
  serializeFormRules,
  serializePricingRules,
  type EligibilityValues,
  type PricingRuleRow,
} from "./rules-editor";

export interface DayPassFormValues {
  weekdayPriceHuf: number;
  weekendPriceHuf: number;
  weekendDays: number[];
  dailyCapacity: number | null;
  capacityOverrides: Array<{ date: string; capacity: number | "" }>;
  closedDays: string;
}

export const EMPTY_DAY_PASS: DayPassFormValues = {
  weekdayPriceHuf: 0,
  weekendPriceHuf: 0,
  weekendDays: [6, 0],
  dailyCapacity: null,
  capacityOverrides: [],
  closedDays: "",
};

export type EligibilityFormValues = Omit<EligibilityValues, "rules"> & {
  rules: Array<{ id: string; fieldKey: string; op: string; value: string; message: string }>;
};

export const EMPTY_ELIGIBILITY: EligibilityFormValues = {
  preset: "none",
  minAge: "",
  maxAge: "",
  genders: [],
  birthDateFieldKey: "",
  genderFieldKey: "",
  logic: "and",
  rules: [],
};

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const STEPS: Array<{ id: string; label: string; hint: string; icon: LucideIcon }> = [
  { id: "basics", label: "Basics", hint: "Name, dates, venue", icon: CalendarDays },
  { id: "tickets", label: "Tickets", hint: "Price and capacity", icon: Ticket },
  { id: "form", label: "Registration form", hint: "What guests are asked", icon: ClipboardList },
  { id: "rules", label: "Rules & pricing", hint: "Who can join, price changes", icon: Scale },
  { id: "sales", label: "Publishing", hint: "When and where it's sold", icon: Megaphone },
];

export interface EventFormValues {
  kind: string;
  dayPass: DayPassFormValues;
  groupId: string;
  name: string;
  description: string;
  address: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  salesOpensAt: string;
  salesClosesAt: string;
  currency: string;
  ticketFeeHuf: number;
  ticketFeeMode: string;
  registrationUnit: string;
  playersPerTicket: number;
  ticketPriceBasis: string;
  ticketVatPercent: number;
  capacity: number | null;
  vouchersEnabled: boolean;
  publicListing: string;
  status: string;
  tdartsEnabled: boolean;
  tdartsTournamentCode: string;
  attendeeFieldSchema: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    helpText?: string;
    choices?: Array<{ value: string; label: string }>;
  }>;
  attendeeFieldSchemaMode: string;
  eligibility: EligibilityFormValues;
  pricingRules: Array<{ id: string; enabled: boolean; label: string; when: string; action: string; amount: number; amountMode: string }>;
}

/**
 * Event editor. The fields are split over steps so each screen holds one
 * decision, but every step stays mounted (just hidden) so the whole event is
 * one form submission. A new event walks the steps with Back / Next and is
 * created on the last one; a saved event can jump anywhere and save from any
 * step.
 */
export function EventForm({
  eventId,
  initial,
  groups,
  soldGuestCount,
}: {
  eventId: string | null;
  initial: EventFormValues;
  groups: Array<{ id: string; name: string }>;
  soldGuestCount?: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const isNew = eventId === null;
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState(initial.kind);
  const [overrides, setOverrides] = useState(initial.dayPass.capacityOverrides);
  const [fieldRows, setFieldRows] = useState<FieldRow[]>(() => fieldRowsFromDefs(initial.attendeeFieldSchema));
  const [eligibility, setEligibility] = useState<EligibilityValues>(() => ({
    ...initial.eligibility,
    rules: initial.eligibility.rules.map((rule) => ({ ...rule, uid: rule.id || newRuleUid() })),
  }));
  const [pricingRows, setPricingRows] = useState<PricingRuleRow[]>(() =>
    initial.pricingRules.map((rule) => ({ ...rule, uid: rule.id || newRuleUid() })),
  );
  const savedKeys = useMemo(() => new Set(initial.attendeeFieldSchema.map((field) => field.key)), [initial.attendeeFieldSchema]);
  const questions = useMemo(() => effectiveFieldKeys(fieldRows), [fieldRows]);

  const [state, action, pending] = useActionState(async (_prev: CatalogActionResult | null, formData: FormData) => {
    const result = await saveEventAction(eventId, formData);
    if (result.ok && !eventId && result.id) router.replace(`/admin/events/${result.id}`);
    return result;
  }, null);

  const last = step === STEPS.length - 1;

  /** Moves forward only when what's on screen is valid, pointing at the first problem otherwise. */
  function next() {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${STEPS[step]!.id}"]`);
    const controls = panel?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [];
    for (const control of controls) {
      if (!control.checkValidity()) {
        control.reportValidity();
        return;
      }
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start"
      // A submit blocked by a field on a hidden step would fail silently, so jump to that step.
      onInvalidCapture={(event) => {
        const panel = (event.target as HTMLElement).closest<HTMLElement>("[data-step]");
        const index = STEPS.findIndex((item) => item.id === panel?.dataset.step);
        if (index >= 0) setStep(index);
      }}
      // Enter inside a field would submit a half-filled new event; make it mean "next" instead.
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.key === "Enter" && isNew && !last && target.tagName === "INPUT") {
          event.preventDefault();
          next();
        }
      }}
    >
      <nav aria-label="Event sections" className="lg:sticky lg:top-20">
        <ol className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const active = index === step;
            return (
              <li key={item.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => setStep(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                      active && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {isNew ? index + 1 : <Icon className="size-3.5" />}
                  </span>
                  <span className="grid">
                    <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
                    <span className="hidden text-xs font-normal lg:block">{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid min-w-0 gap-6">
        <div data-step="basics" className={cn("grid gap-6", step !== 0 && "hidden")}>
          <SectionCard title="Basics">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <FormField label="Name" htmlFor="name">
                  <Input id="name" name="name" required defaultValue={initial.name} />
                </FormField>
                <FormField label="Group" htmlFor="groupId">
                  <NativeSelect id="groupId" name="groupId" required defaultValue={initial.groupId}>
                    <option value="" disabled>
                      Choose a group…
                    </option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Description" htmlFor="description">
                  <Textarea id="description" name="description" rows={4} defaultValue={initial.description} />
                </FormField>
                <div className="grid content-start gap-4">
                  <FormField label="Venue address" htmlFor="address">
                    <Input id="address" name="address" defaultValue={initial.address} />
                  </FormField>
                  <FormField
                    label="Event type"
                    htmlFor="kind"
                    hint={
                      kind === "day_pass"
                        ? "Guests buy passes for the days they choose, priced per day with a capacity per day."
                        : "One entry, one price, one capacity."
                    }
                  >
                    <NativeSelect id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                      <option value="standard">Standard event</option>
                      <option value="day_pass">Multi-day with day passes</option>
                    </NativeSelect>
                  </FormField>
                </div>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="When">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FormField label="Start date" htmlFor="startDate">
                <Input id="startDate" name="startDate" type="date" required defaultValue={initial.startDate} />
              </FormField>
              <FormField label="End date" htmlFor="endDate">
                <Input id="endDate" name="endDate" type="date" required defaultValue={initial.endDate} />
              </FormField>
              <FormField label="Start time" htmlFor="startTime">
                <Input id="startTime" name="startTime" type="time" defaultValue={initial.startTime} />
              </FormField>
              <FormField label="End time" htmlFor="endTime">
                <Input id="endTime" name="endTime" type="time" defaultValue={initial.endTime} />
              </FormField>
            </div>
          </SectionCard>
        </div>

        <div data-step="tickets" className={cn("grid gap-6", step !== 1 && "hidden")}>
          {kind === "day_pass" ? (
            <>
              <input type="hidden" name="capacityOverrides" value={JSON.stringify(overrides)} />
              <div className="grid gap-6 xl:grid-cols-2">
                <SectionCard
                  title="Day pass pricing"
                  description={`Every day from the start to the end date can be sold.${soldGuestCount !== undefined ? ` ${soldGuestCount} entries sold so far.` : ""}`}
                >
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Weekday pass price" htmlFor="weekdayPriceHuf">
                        <Input id="weekdayPriceHuf" name="weekdayPriceHuf" type="number" min={0} required defaultValue={initial.dayPass.weekdayPriceHuf} />
                      </FormField>
                      <FormField label="Weekend pass price" htmlFor="weekendPriceHuf">
                        <Input id="weekendPriceHuf" name="weekendPriceHuf" type="number" min={0} required defaultValue={initial.dayPass.weekendPriceHuf} />
                      </FormField>
                    </div>
                    <PriceSettings initial={initial} />
                    <fieldset className="grid gap-2">
                      <legend className="text-sm font-medium">Weekend rate applies on</legend>
                      <div className="flex flex-wrap gap-4">
                        {WEEKDAYS.map((day) => (
                          <CheckboxField
                            key={day.value}
                            name="weekendDays"
                            value={String(day.value)}
                            label={day.label}
                            defaultChecked={initial.dayPass.weekendDays.includes(day.value)}
                          />
                        ))}
                      </div>
                    </fieldset>
                  </div>
                </SectionCard>
                <SectionCard title="Capacity per day" description="How many passes can be sold for each date.">
                  <div className="grid gap-4">
                    <FormField label="Passes per day" htmlFor="dailyCapacity" hint="Empty = unlimited.">
                      <Input id="dailyCapacity" name="dailyCapacity" type="number" min={0} defaultValue={initial.dayPass.dailyCapacity ?? ""} />
                    </FormField>
                    <FormField label="Closed days" htmlFor="closedDays" hint="Dates with no sales, as yyyy-mm-dd, separated by spaces or commas.">
                      <Input id="closedDays" name="closedDays" defaultValue={initial.dayPass.closedDays} placeholder="2026-07-14, 2026-07-15" />
                    </FormField>
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Capacity exceptions</p>
                      {overrides.map((row, index) => (
                        <div key={index} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                          <FormField label="Date" htmlFor={`override-date-${index}`}>
                            <Input
                              id={`override-date-${index}`}
                              type="date"
                              value={row.date}
                              onChange={(e) => setOverrides((rows) => rows.map((r, i) => (i === index ? { ...r, date: e.target.value } : r)))}
                            />
                          </FormField>
                          <FormField label="Passes" htmlFor={`override-cap-${index}`}>
                            <Input
                              id={`override-cap-${index}`}
                              type="number"
                              min={0}
                              value={row.capacity}
                              onChange={(e) =>
                                setOverrides((rows) => rows.map((r, i) => (i === index ? { ...r, capacity: e.target.value === "" ? "" : Number(e.target.value) } : r)))
                              }
                            />
                          </FormField>
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove exception" onClick={() => setOverrides((rows) => rows.filter((_, i) => i !== index))}>
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button type="button" variant="outline" size="sm" onClick={() => setOverrides((rows) => [...rows, { date: "", capacity: "" }])}>
                          <Plus /> Add exception
                        </Button>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </>
          ) : (
            <div className="grid gap-6 xl:grid-cols-2">
              <SectionCard
                title="Price"
                description={soldGuestCount !== undefined ? `${soldGuestCount} entries sold so far.` : "What one entry costs."}
              >
                <div className="grid gap-4">
                  <FormField label="Ticket price" htmlFor="ticketFeeHuf">
                    <Input id="ticketFeeHuf" name="ticketFeeHuf" type="number" min={0} step="1" required defaultValue={initial.ticketFeeHuf} />
                  </FormField>
                  <PriceSettings initial={initial} />
                  <FormField label="Price applies" htmlFor="ticketFeeMode">
                    <NativeSelect id="ticketFeeMode" name="ticketFeeMode" defaultValue={initial.ticketFeeMode}>
                      <option value="per_person">Per person</option>
                      <option value="per_booking">Per booking</option>
                      <option value="per_team">Per team</option>
                    </NativeSelect>
                  </FormField>
                </div>
              </SectionCard>
              <SectionCard title="Who registers" description="How many people one ticket covers, and how many tickets exist.">
                <div className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Registration unit" htmlFor="registrationUnit">
                      <NativeSelect id="registrationUnit" name="registrationUnit" defaultValue={initial.registrationUnit}>
                        <option value="person">Person</option>
                        <option value="team">Team</option>
                      </NativeSelect>
                    </FormField>
                    <FormField label="Players per ticket" htmlFor="playersPerTicket">
                      <Input id="playersPerTicket" name="playersPerTicket" type="number" min={1} max={100} defaultValue={initial.playersPerTicket} />
                    </FormField>
                  </div>
                  <FormField label="Capacity" htmlFor="capacity" hint="Leave empty for no limit.">
                    <Input id="capacity" name="capacity" type="number" min={0} defaultValue={initial.capacity ?? ""} />
                  </FormField>
                </div>
              </SectionCard>
            </div>
          )}
        </div>

        <div data-step="form" className={cn("grid gap-6", step !== 2 && "hidden")}>
          <input type="hidden" name="attendeeFieldSchema" value={serializeFieldRows(fieldRows)} />
          <SectionCard
            title="Registration form"
            description="Every guest is asked for their name and contact details. Add the extra questions this event needs — shirt size, club, date of birth."
          >
            <div className="grid gap-5">
              <RegistrationFieldsEditor rows={fieldRows} onChange={setFieldRows} keysLocked={savedKeys} />
              <FormField
                label="Questions from the group"
                htmlFor="attendeeFieldSchemaMode"
                hint="The group may already ask some questions of every event it runs."
                className="max-w-xl"
              >
                <NativeSelect id="attendeeFieldSchemaMode" name="attendeeFieldSchemaMode" defaultValue={initial.attendeeFieldSchemaMode}>
                  <option value="extend">Ask these in addition to the group's</option>
                  <option value="replace">Ask only these (ignore the group's)</option>
                </NativeSelect>
              </FormField>
            </div>
          </SectionCard>
        </div>

        <div data-step="rules" className={cn("grid gap-6", step !== 3 && "hidden")}>
          <input type="hidden" name="eligibilityPreset" value={eligibility.preset} />
          <input type="hidden" name="eligibilityMinAge" value={eligibility.preset === "custom" ? eligibility.minAge : ""} />
          <input type="hidden" name="eligibilityMaxAge" value={eligibility.preset === "custom" ? eligibility.maxAge : ""} />
          <input type="hidden" name="eligibilityBirthDateFieldKey" value={eligibility.birthDateFieldKey} />
          <input type="hidden" name="eligibilityGenderFieldKey" value={eligibility.genderFieldKey} />
          {eligibility.preset === "custom" ? eligibility.genders.map((gender) => <input key={gender} type="hidden" name="eligibilityAllowedGenders" value={gender} />) : null}
          <input type="hidden" name="eligibilityFormRules" value={eligibility.preset === "form_rules" ? serializeFormRules(eligibility) : ""} />
          <input type="hidden" name="pricingRules" value={serializePricingRules(pricingRows)} />
          <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
            <SectionCard title="Who can register" description="Keep an event to the right age group, gender or members.">
              <EligibilityEditor value={eligibility} onChange={setEligibility} fields={questions} />
            </SectionCard>
            <SectionCard title="Price adjustments" description="Discounts and surcharges applied automatically — a hotel guest discount, a late fee.">
              <PricingRulesEditor rows={pricingRows} onChange={setPricingRows} />
            </SectionCard>
          </div>
        </div>

        <div data-step="sales" className={cn("grid gap-6", step !== 4 && "hidden")}>
          <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
            <SectionCard title="Sales window">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Sales open" htmlFor="salesOpensAt">
                  <Input id="salesOpensAt" name="salesOpensAt" type="datetime-local" defaultValue={initial.salesOpensAt} />
                </FormField>
                <FormField label="Sales close" htmlFor="salesClosesAt">
                  <Input id="salesClosesAt" name="salesClosesAt" type="datetime-local" defaultValue={initial.salesClosesAt} />
                </FormField>
                <FormField label="Status" htmlFor="status" hint="Only active events can be booked.">
                  <StatusSelect defaultValue={initial.status} />
                </FormField>
                <FormField label="Public listing" htmlFor="publicListing" hint="Link only: bookable, but not shown in lists.">
                  <NativeSelect id="publicListing" name="publicListing" defaultValue={initial.publicListing}>
                    <option value="listed">Listed</option>
                    <option value="link_only">Link only</option>
                  </NativeSelect>
                </FormField>
              </div>
            </SectionCard>
            <SectionCard title="Tickets & integrations">
              <div className="grid gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch name="vouchersEnabled" defaultChecked={initial.vouchersEnabled} />
                  Issue entry vouchers (QR tickets)
                </label>
                <div className="grid gap-4 border-t pt-4 sm:grid-cols-2 sm:items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch name="tdartsEnabled" defaultChecked={initial.tdartsEnabled} />
                    Sync entries to a tDarts tournament
                  </label>
                  <FormField label="tDarts tournament code" htmlFor="tdartsTournamentCode">
                    <Input id="tdartsTournamentCode" name="tdartsTournamentCode" defaultValue={initial.tdartsTournamentCode} />
                  </FormField>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>

        <ResultNotice result={state} />

        <div className="bg-background/90 sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t px-1 py-3 backdrop-blur">
          <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((current) => Math.max(current - 1, 0))}>
            <ArrowLeft /> Back
          </Button>
          {!last ? (
            <Button type="button" variant={isNew ? "default" : "outline"} onClick={next}>
              Next <ArrowRight />
            </Button>
          ) : null}
          {!isNew || last ? (
            <Button type="submit" disabled={pending} className={cn(!isNew && "ml-auto")}>
              {pending ? "Saving…" : isNew ? "Create event" : "Save event"}
            </Button>
          ) : null}
          {isNew && !last ? (
            <span className="text-muted-foreground ml-auto text-sm">
              Step {step + 1} of {STEPS.length}
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** Currency, price basis and VAT — the same four controls for both event kinds. */
function PriceSettings({ initial }: { initial: EventFormValues }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <FormField label="Currency" htmlFor="currency">
        <Input id="currency" name="currency" maxLength={3} defaultValue={initial.currency} />
      </FormField>
      <FormField label="Price basis" htmlFor="ticketPriceBasis">
        <NativeSelect id="ticketPriceBasis" name="ticketPriceBasis" defaultValue={initial.ticketPriceBasis}>
          <option value="net">Net</option>
          <option value="gross">Gross</option>
        </NativeSelect>
      </FormField>
      <FormField label="VAT %" htmlFor="ticketVatPercent">
        <Input id="ticketVatPercent" name="ticketVatPercent" type="number" min={0} max={100} step="0.1" defaultValue={initial.ticketVatPercent} />
      </FormField>
    </div>
  );
}
