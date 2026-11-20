"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { saveBookingColumnsAction } from "./column-actions";

export interface PickerColumn {
  key: string;
  label: string;
}

/** Choose which columns the bookings table shows; the choice is saved and reused on the next visit. */
export function ColumnPicker({ builtIn, fields, selected }: { builtIn: PickerColumn[]; fields: PickerColumn[]; selected: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(selected);

  function toggle(key: string, on: boolean) {
    const next = on ? [...current, key] : current.filter((value) => value !== key);
    setCurrent(next);
    startTransition(async () => {
      await saveBookingColumnsAction(next);
      router.refresh();
    });
  }

  const item = (column: PickerColumn) => (
    <DropdownMenuCheckboxItem key={column.key} checked={current.includes(column.key)} onSelect={(event) => event.preventDefault()} onCheckedChange={(on) => toggle(column.key, on)}>
      {column.label}
    </DropdownMenuCheckboxItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={pending}>
          <Columns3 /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
        <DropdownMenuLabel>Table columns</DropdownMenuLabel>
        {builtIn.map(item)}
        {fields.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Guest answers</DropdownMenuLabel>
            {fields.map(item)}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
