import { scanVoucherAsAdmin } from "@tbook/services";
import { adminVoucherScanSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2 } from "@/lib/v2/response";
import { toVoucherDto } from "@/lib/v2/serialize";

/**
 * v2 — check-in scan. Always 200 with a `result` discriminator rather than
 * an HTTP error for a bad code: the door scanner needs to render "already
 * checked in" / "wrong event" as outcomes, not as request failures. Only
 * genuine auth/validation problems are HTTP errors.
 *
 * Rate-limited because this endpoint is driven by a camera loop — a stuck
 * scanner pointed at one code would otherwise hammer it.
 */
export async function POST(request: Request) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("voucher:scan");
    enforceV1RateLimit(request, "t-book:admin-scan", 240);

    const input = parseInput(adminVoucherScanSchema, await readJsonBody(request));
    const user = await getSessionUser();

    const outcome = await scanVoucherAsAdmin(organizationId, input.code, {
      eventId: input.eventId,
      mode: input.mode,
      day: input.day,
      userId: user?.id ?? null,
    });

    return {
      data: {
        result: outcome.result,
        message: outcome.message,
        voucher: outcome.voucher ? toVoucherDto(outcome.voucher) : null,
      },
    };
  });
}
