"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormField, NativeSelect, ResultNotice, StatusSelect } from "@/components/form-bits";
import { saveEventAction, type CatalogActionResult } from "../../catalog-actions";

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

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
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
}

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
  const [kind, setKind] = useState(initial.kind);
  const [overrides, setOverrides] = useState(initial.dayPass.capacityOverrides);
  const [state, action, pending] = useActionState(async (_prev: CatalogActionResult | null, formData: FormData) => {
    const result = await saveEventAction(eventId, formData);
    if (result.ok && !eventId && result.id) router.replace(`/admin/events/${result.id}`);
    return result;
  }, null);

  return (
    <form action={action} className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormField
            label="Event type"
            htmlFor="kind"
            hint={kind === "day_pass" ? "Guests buy passes for the days they choose, with a weekday and a weekend price and a capacity per day." : "One entry, one price, one capacity."}
          >
            <NativeSelect id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="standard">Standard event</option>
              <option value="day_pass">Multi-day with day passes</option>
            </NativeSelect>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
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
          <FormField label="Description" htmlFor="description">
            <Textarea id="description" name="description" rows={3} defaultValue={initial.description} />
          </FormField>
          <FormField label="Venue address" htmlFor="address">
            <Input id="address" name="address" defaultValue={initial.address} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-4">
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
        </CardContent>
      </Card>

      {kind === "day_pass" ? (
        <Card>
          <CardHeader>
            <CardTitle>Day passes</CardTitle>
            <CardDescription>
              Every day from the start to the end date can be sold. Prices use the VAT settings below.
              {soldGuestCount !== undefined ? ` ${soldGuestCount} entries sold so far.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <input type="hidden" name="capacityOverrides" value={JSON.stringify(overrides)} />
            <div className="grid gap-4 sm:grid-cols-4">
              <FormField label="Weekday pass price" htmlFor="weekdayPriceHuf">
                <Input id="weekdayPriceHuf" name="weekdayPriceHuf" type="number" min={0} required defaultValue={initial.dayPass.weekdayPriceHuf} />
              </FormField>
              <FormField label="Weekend pass price" htmlFor="weekendPriceHuf">
                <Input id="weekendPriceHuf" name="weekendPriceHuf" type="number" min={0} required defaultValue={initial.dayPass.weekendPriceHuf} />
              </FormField>
              <FormField label="Passes per day" htmlFor="dailyCapacity" hint="Empty = unlimited.">
                <Input id="dailyCapacity" name="dailyCapacity" type="number" min={0} defaultValue={initial.dayPass.dailyCapacity ?? ""} />
              </FormField>
              <FormField label="Currency" htmlFor="currency">
                <Input id="currency" name="currency" maxLength={3} defaultValue={initial.currency} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
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
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Weekend rate applies on</legend>
              <div className="flex flex-wrap gap-4">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="weekendDays" value={day.value} defaultChecked={initial.dayPass.weekendDays.includes(day.value)} />
                    {day.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <FormField label="Closed days" htmlFor="closedDays" hint="Dates with no sales, as yyyy-mm-dd, separated by spaces or commas.">
              <Input id="closedDays" name="closedDays" defaultValue={initial.dayPass.closedDays} placeholder="2026-07-14, 2026-07-15" />
            </FormField>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Capacity exceptions</p>
              {overrides.map((row, index) => (
                <div key={index} className="grid items-end gap-3 sm:grid-cols-[180px_160px_auto]">
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
                      onChange={(e) => setOverrides((rows) => rows.map((r, i) => (i === index ? { ...r, capacity: e.target.value === "" ? "" : Number(e.target.value) } : r)))}
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
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Tickets &amp; capacity</CardTitle>
          <CardDescription>
            {soldGuestCount !== undefined ? `${soldGuestCount} entries sold so far.` : "Set the price and how many entries can be sold."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Ticket price" htmlFor="ticketFeeHuf">
              <Input id="ticketFeeHuf" name="ticketFeeHuf" type="number" min={0} step="1" required defaultValue={initial.ticketFeeHuf} />
            </FormField>
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
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Price applies" htmlFor="ticketFeeMode">
              <NativeSelect id="ticketFeeMode" name="ticketFeeMode" defaultValue={initial.ticketFeeMode}>
                <option value="per_person">Per person</option>
                <option value="per_booking">Per booking</option>
                <option value="per_team">Per team</option>
              </NativeSelect>
            </FormField>
            <FormField label="Registration unit" htmlFor="registrationUnit">
              <NativeSelect id="registrationUnit" name="registrationUnit" defaultValue={initial.registrationUnit}>
                <option value="person">Person</option>
                <option value="team">Team</option>
              </NativeSelect>
            </FormField>
            <FormField label="Players per ticket" htmlFor="playersPerTicket">
              <Input id="playersPerTicket" name="playersPerTicket" type="number" min={1} max={100} defaultValue={initial.playersPerTicket} />
            </FormField>
            <FormField label="Capacity" htmlFor="capacity" hint="Leave empty for no limit.">
              <Input id="capacity" name="capacity" type="number" min={0} defaultValue={initial.capacity ?? ""} />
            </FormField>
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sales &amp; visibility</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Sales open" htmlFor="salesOpensAt">
              <Input id="salesOpensAt" name="salesOpensAt" type="datetime-local" defaultValue={initial.salesOpensAt} />
            </FormField>
            <FormField label="Sales close" htmlFor="salesClosesAt">
              <Input id="salesClosesAt" name="salesClosesAt" type="datetime-local" defaultValue={initial.salesClosesAt} />
            </FormField>
            <FormField label="Status" htmlFor="status">
              <StatusSelect defaultValue={initial.status} />
            </FormField>
            <FormField label="Public listing" htmlFor="publicListing">
              <NativeSelect id="publicListing" name="publicListing" defaultValue={initial.publicListing}>
                <option value="listed">Listed</option>
                <option value="link_only">Link only</option>
              </NativeSelect>
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch name="vouchersEnabled" defaultChecked={initial.vouchersEnabled} />
            Issue entry vouchers (QR tickets)
          </label>
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch name="tdartsEnabled" defaultChecked={initial.tdartsEnabled} />
              Sync entries to a tDarts tournament
            </label>
            <FormField label="tDarts tournament code" htmlFor="tdartsTournamentCode">
              <Input id="tdartsTournamentCode" name="tdartsTournamentCode" defaultValue={initial.tdartsTournamentCode} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <ResultNotice result={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : eventId ? "Save event" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
