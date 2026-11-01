import { NextResponse } from "next/server";
import { createReservation } from "@tbook/services";
import { createReservationInputSchema } from "@tbook/schemas";
import { parseBody, requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** POST — hold stock for a checkout. 201 when created, 200 when the reference already had one. */
export async function POST(request: Request) {
  let created = false;
  const response = await runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const input = await parseBody(request, createReservationInputSchema);
    const result = await createReservation(organizationId, input, "api");
    created = result.created;
    return { data: result.reservation, meta: { created } };
  });
  return created ? new NextResponse(response.body, { status: 201, headers: response.headers }) : response;
}
