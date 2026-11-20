"use server";

import { cookies } from "next/headers";
import { requireOrgPermission } from "@/lib/admin-auth";
import { BOOKING_COLUMNS_COOKIE } from "./columns";

/** Remembers which columns the bookings table shows (a browser preference, not shared data). */
export async function saveBookingColumnsAction(columns: string[]): Promise<void> {
  await requireOrgPermission("booking:read");
  const clean = columns.filter((value) => typeof value === "string" && value.length <= 80).slice(0, 40);
  (await cookies()).set(BOOKING_COLUMNS_COOKIE, JSON.stringify(clean), { path: "/admin", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
}
