"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Unlink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import {
  deleteBusRouteAction,
  recountBusSeatsAction,
  revokeCaptainLinkAction,
  rotateCaptainLinkAction,
  saveBusRouteAction,
  sendCaptainNoticeAction,
  type BusActionResult,
} from "../bus-actions";

export interface BusRouteFormValues {
  id: string;
  code: string;
  city: string;
  pickupPoint: string;
  departureAt: string;
  returnInfo: string;
  capacity: number;
  captainName: string;
  captainPhone: string;
  notes: string;
  active: boolean;
  sortOrder: number;
  /** Pickup stops; departureAt as a datetime-local value. */
  stops: BusStopFormValues[];
}

export interface BusStopFormValues {
  city: string;
  pickupPoint: string;
  departureAt: string;
}

/** Repeatable stop rows: a multi-stop bus whose stops share its seats. No rows = a single-stop bus. */
function BusStopsEditor({ initial }: { initial: BusStopFormValues[] }) {
  const [stops, setStops] = useState<Array<BusStopFormValues & { key: number }>>(() => initial.map((stop, index) => ({ ...stop, key: index })));
  const add = () => setStops((current) => [...current, { city: "", pickupPoint: "", departureAt: "", key: Date.now() }]);
  const remove = (key: number) => setStops((current) => current.filter((stop) => stop.key !== key));
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Stops</legend>
      <p className="text-muted-foreground text-xs">
        Optional. A bus with several pickup stops (e.g. 13:30 Szombathely, 15:00 Győr, 16:00 Tatabánya): guests pick a stop, all stops share the seats. Then
        the City above is the bus&apos;s name. No stops = guests board at the pickup point above.
      </p>
      {stops.map((stop, index) => (
        <div key={stop.key} className="grid items-end gap-2 sm:grid-cols-[1fr_1.4fr_1.2fr_auto]">
          <Input name="stopCity" aria-label={`Stop ${index + 1} city`} placeholder="City" defaultValue={stop.city} required />
          <Input name="stopPickupPoint" aria-label={`Stop ${index + 1} pickup point`} placeholder="Pickup point" defaultValue={stop.pickupPoint} />
          <Input name="stopDepartureAt" aria-label={`Stop ${index + 1} departure`} type="datetime-local" defaultValue={stop.departureAt} />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove stop ${index + 1}`} onClick={() => remove(stop.key)}>
            <X />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus /> Add stop
        </Button>
      </div>
    </fieldset>
  );
}

export function BusEventPicker({ events, value }: { events: Array<{ id: string; name: string }>; value: string }) {
  const router = useRouter();
  return (
    <NativeSelect aria-label="Event" value={value} className="w-64" onChange={(e) => router.push(`/admin/bus?eventId=${e.target.value}`)}>
      {events.map((event) => (
        <option key={event.id} value={event.id}>
          {event.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export function RecountSeatsButton({ eventId }: { eventId: string }) {
  const [result, setResult] = useState<BusActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid justify-items-end gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => setResult(await recountBusSeatsAction(eventId)))}>
        <RefreshCw /> Recount seats
      </Button>
      {result ? <ResultNotice result={result} /> : null}
    </div>
  );
}

export function BusRouteDialog({
  eventId,
  route,
  open: controlledOpen,
  onOpenChange,
}: {
  eventId: string;
  route: BusRouteFormValues | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [state, action, pending] = useActionState(async (_prev: BusActionResult | null, formData: FormData) => {
    const result = await saveBusRouteAction(eventId, route?.id ?? null, formData);
    if (result.ok) setOpen(false);
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {route ? null : (
        <DialogTrigger asChild>
          <Button>
            <Plus /> Add bus
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{route ? `Bus ${route.code}` : "New bus"}</DialogTitle>
          <DialogDescription>Guests see the city, pickup point and departure when they choose a bus.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <FormField label="Code" htmlFor="bus-code" hint="E.g. B03">
              <Input id="bus-code" name="code" defaultValue={route?.code} required />
            </FormField>
            <FormField label="City" htmlFor="bus-city">
              <Input id="bus-city" name="city" defaultValue={route?.city} required />
            </FormField>
          </div>
          <FormField label="Pickup point" htmlFor="bus-pickup">
            <Input id="bus-pickup" name="pickupPoint" defaultValue={route?.pickupPoint} placeholder="Mars tér, buszpályaudvar" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Departure (Budapest time)" htmlFor="bus-departure">
              <Input id="bus-departure" name="departureAt" type="datetime-local" defaultValue={route?.departureAt} />
            </FormField>
            <FormField label="Seats" htmlFor="bus-capacity">
              <Input id="bus-capacity" name="capacity" type="number" min={1} defaultValue={route?.capacity ?? 50} required />
            </FormField>
          </div>
          <BusStopsEditor initial={route?.stops ?? []} />
          <FormField label="Return trip" htmlFor="bus-return" hint="Shown in the bus email, e.g. “00:00–02:00, coordinated by the captain”.">
            <Input id="bus-return" name="returnInfo" defaultValue={route?.returnInfo} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Captain's name" htmlFor="bus-captain">
              <Input id="bus-captain" name="captainName" defaultValue={route?.captainName} />
            </FormField>
            <FormField label="Captain's phone" htmlFor="bus-captain-phone">
              <Input id="bus-captain-phone" name="captainPhone" type="tel" defaultValue={route?.captainPhone} />
            </FormField>
          </div>
          <FormField label="Internal notes" htmlFor="bus-notes">
            <Textarea id="bus-notes" name="notes" rows={2} defaultValue={route?.notes} />
          </FormField>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <CheckboxField name="active" label="Offered at registration" defaultChecked={route?.active ?? true} />
            <FormField label="Order" htmlFor="bus-order" className="w-24">
              <Input id="bus-order" name="sortOrder" type="number" defaultValue={route?.sortOrder ?? 0} />
            </FormField>
          </div>
          <ResultNotice result={state} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BusRouteRowActions({
  eventId,
  route,
  hasLink,
  captainNoticePending,
}: {
  eventId: string;
  route: BusRouteFormValues;
  hasLink: boolean;
  /** Passengers of this bus without its current captain's details (null: the bus has no captain name/phone). */
  captainNoticePending: number | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [result, setResult] = useState<BusActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<BusActionResult>) => startTransition(async () => setResult(await fn()));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for bus ${route.code}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(() => rotateCaptainLinkAction(route.id))}>
            <Link2 /> {hasLink ? "New captain link" : "Create captain link"}
          </DropdownMenuItem>
          {hasLink ? (
            <DropdownMenuItem onSelect={() => run(() => revokeCaptainLinkAction(route.id))}>
              <Unlink /> Revoke captain link
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={!captainNoticePending} onSelect={() => setNoticeOpen(true)}>
            <Mail /> Send captain details to passengers
            {captainNoticePending == null ? " (no captain yet)" : ` (${captainNoticePending})`}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BusRouteDialog eventId={eventId} route={route} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete bus {route.code}?</DialogTitle>
            <DialogDescription>A bus with booked passengers can’t be deleted — hide it from registration instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await deleteBusRouteAction(route.id);
                  setDeleteOpen(false);
                  setResult(outcome);
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send captain details — bus {route.code}</DialogTitle>
            <DialogDescription>
              {captainNoticePending ?? 0} passengers of this bus haven&apos;t received the details of {route.captainName} ({route.captainPhone}) yet. They get the
              “Bus: captain&apos;s details” email (Emails page) and are then marked informed. Test registrations are not included.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoticeOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !captainNoticePending}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await sendCaptainNoticeAction(route.id);
                  setNoticeOpen(false);
                  setResult(outcome);
                })
              }
            >
              <Mail /> Send to {captainNoticePending ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(result)} onOpenChange={(next) => (next ? null : setResult(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bus {route.code}</DialogTitle>
          </DialogHeader>
          {result?.captainUrl ? (
            <div className="grid gap-3 text-left">
              <Notice tone="warning">Copy the link now — it isn’t shown again. Send it to {route.captainName || "the captain"}; it opens this bus’s passenger list only.</Notice>
              <div className="flex items-center gap-2">
                <code className="bg-muted min-w-0 flex-1 rounded px-2 py-1 font-mono text-xs break-all">{result.captainUrl}</code>
                <Button type="button" size="icon-sm" variant="outline" aria-label="Copy captain link" onClick={() => navigator.clipboard.writeText(result.captainUrl!)}>
                  <Copy />
                </Button>
              </div>
            </div>
          ) : (
            <ResultNotice result={result} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
