"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, NativeSelect, ResultNotice, StatusSelect } from "@/components/form-bits";
import { saveHotelAction, type CatalogActionResult } from "../../catalog-actions";

export interface RoomTypeRow {
  key: string;
  label: string;
  baseRateHuf: number;
  sortOrder: number;
}

export interface PackageRow {
  key: string;
  label: string;
  nights: number;
  priceHuf: number;
  maxGuests: number | null;
  inventoryUnits: number | null;
  roomTypeKey: string | null;
  sortOrder: number;
}

export interface HotelFormValues {
  groupId: string;
  name: string;
  description: string;
  address: string;
  distanceFromVenueKm: number | null;
  contactEmail: string;
  contactPhone: string;
  currency: string;
  bookingCapacity: number | null;
  roomInventory: number | null;
  status: string;
  priceBasis: string;
  vatPercent: number;
  roomTypes: RoomTypeRow[];
  packages: PackageRow[];
}

/** Stable machine key from a label, unique within the existing rows. */
function makeKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}-${i}`;
  return key;
}

const numberOrNull = (raw: string) => (raw === "" ? null : Number(raw));

export function HotelForm({
  hotelId,
  initial,
  groups,
}: {
  hotelId: string | null;
  initial: HotelFormValues;
  groups: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [roomTypes, setRoomTypes] = useState<RoomTypeRow[]>(initial.roomTypes);
  const [packages, setPackages] = useState<PackageRow[]>(initial.packages);

  const [state, action, pending] = useActionState(async (_prev: CatalogActionResult | null, formData: FormData) => {
    const result = await saveHotelAction(hotelId, formData);
    if (result.ok && !hotelId && result.id) router.replace(`/admin/hotels/${result.id}`);
    return result;
  }, null);

  function patchRoom(index: number, patch: Partial<RoomTypeRow>) {
    setRoomTypes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function patchPackage(index: number, patch: Partial<PackageRow>) {
    setPackages((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <form action={action} className="grid max-w-4xl gap-6">
      <input type="hidden" name="roomTypes" value={JSON.stringify(roomTypes)} />
      <input type="hidden" name="packages" value={JSON.stringify(packages)} />

      <Card>
        <CardHeader>
          <CardTitle>Hotel</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="name">
              <Input id="name" name="name" required defaultValue={initial.name} />
            </FormField>
            <FormField label="Group" htmlFor="groupId" hint="Hotels are shared by every event in the group.">
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
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Address" htmlFor="address" className="sm:col-span-2">
              <Input id="address" name="address" defaultValue={initial.address} />
            </FormField>
            <FormField label="Distance from venue (km)" htmlFor="distanceFromVenueKm">
              <Input id="distanceFromVenueKm" name="distanceFromVenueKm" type="number" min={0} step="0.1" defaultValue={initial.distanceFromVenueKm ?? ""} />
            </FormField>
            <FormField label="Contact email" htmlFor="contactEmail">
              <Input id="contactEmail" name="contactEmail" type="email" defaultValue={initial.contactEmail} />
            </FormField>
            <FormField label="Contact phone" htmlFor="contactPhone">
              <Input id="contactPhone" name="contactPhone" defaultValue={initial.contactPhone} />
            </FormField>
            <FormField label="Status" htmlFor="status">
              <StatusSelect defaultValue={initial.status} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Currency" htmlFor="currency">
              <Input id="currency" name="currency" maxLength={3} defaultValue={initial.currency} />
            </FormField>
            <FormField label="Price basis" htmlFor="priceBasis">
              <NativeSelect id="priceBasis" name="priceBasis" defaultValue={initial.priceBasis}>
                <option value="net">Net</option>
                <option value="gross">Gross</option>
              </NativeSelect>
            </FormField>
            <FormField label="VAT %" htmlFor="vatPercent">
              <Input id="vatPercent" name="vatPercent" type="number" min={0} max={100} step="0.1" defaultValue={initial.vatPercent} />
            </FormField>
            <FormField label="Room inventory" htmlFor="roomInventory" hint="Empty = unlimited.">
              <Input id="roomInventory" name="roomInventory" type="number" min={0} defaultValue={initial.roomInventory ?? ""} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Room types</CardTitle>
          <CardDescription>Nightly rates, used when guests book by the night.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {roomTypes.map((room, index) => (
            <div key={room.key} className="grid items-end gap-3 sm:grid-cols-[1fr_160px_auto]">
              <FormField label="Label" htmlFor={`room-label-${index}`}>
                <Input id={`room-label-${index}`} value={room.label} onChange={(e) => patchRoom(index, { label: e.target.value })} />
              </FormField>
              <FormField label="Rate / night" htmlFor={`room-rate-${index}`}>
                <Input id={`room-rate-${index}`} type="number" min={0} value={room.baseRateHuf} onChange={(e) => patchRoom(index, { baseRateHuf: Number(e.target.value) })} />
              </FormField>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove room type" onClick={() => setRoomTypes((rows) => rows.filter((_, i) => i !== index))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRoomTypes((rows) => [
                  ...rows,
                  { key: makeKey(`room ${rows.length + 1}`, rows.map((r) => r.key)), label: "", baseRateHuf: 0, sortOrder: rows.length },
                ])
              }
            >
              <Plus /> Add room type
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Packages</CardTitle>
          <CardDescription>Fixed-price stays. Inventory is the number of units you can sell in total.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {packages.map((pkg, index) => (
            <div key={pkg.key} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-6">
              <FormField label="Label" htmlFor={`pkg-label-${index}`} className="sm:col-span-2">
                <Input id={`pkg-label-${index}`} value={pkg.label} onChange={(e) => patchPackage(index, { label: e.target.value })} />
              </FormField>
              <FormField label="Nights" htmlFor={`pkg-nights-${index}`}>
                <Input id={`pkg-nights-${index}`} type="number" min={1} value={pkg.nights} onChange={(e) => patchPackage(index, { nights: Number(e.target.value) || 1 })} />
              </FormField>
              <FormField label="Price" htmlFor={`pkg-price-${index}`}>
                <Input id={`pkg-price-${index}`} type="number" min={0} value={pkg.priceHuf} onChange={(e) => patchPackage(index, { priceHuf: Number(e.target.value) })} />
              </FormField>
              <FormField label="Max guests" htmlFor={`pkg-guests-${index}`}>
                <Input id={`pkg-guests-${index}`} type="number" min={1} value={pkg.maxGuests ?? ""} onChange={(e) => patchPackage(index, { maxGuests: numberOrNull(e.target.value) })} />
              </FormField>
              <FormField label="Inventory" htmlFor={`pkg-inv-${index}`}>
                <Input id={`pkg-inv-${index}`} type="number" min={0} value={pkg.inventoryUnits ?? ""} onChange={(e) => patchPackage(index, { inventoryUnits: numberOrNull(e.target.value) })} />
              </FormField>
              <div className="sm:col-span-6 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPackages((rows) => rows.filter((_, i) => i !== index))}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPackages((rows) => [
                  ...rows,
                  {
                    key: makeKey(`package ${rows.length + 1}`, rows.map((r) => r.key)),
                    label: "",
                    nights: 1,
                    priceHuf: 0,
                    maxGuests: null,
                    inventoryUnits: null,
                    roomTypeKey: null,
                    sortOrder: rows.length,
                  },
                ])
              }
            >
              <Plus /> Add package
            </Button>
          </div>
        </CardContent>
      </Card>

      <ResultNotice result={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : hotelId ? "Save hotel" : "Create hotel"}
        </Button>
      </div>
    </form>
  );
}
