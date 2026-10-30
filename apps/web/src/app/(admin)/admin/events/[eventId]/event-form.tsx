"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormField, NativeSelect, ResultNotice, StatusSelect } from "@/components/form-bits";
import { saveEventAction, type CatalogActionResult } from "../../catalog-actions";

export interface EventFormValues {
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
