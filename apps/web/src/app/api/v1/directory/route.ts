import { listPublicDirectory } from "@tbook/services";
import { runV1 } from "@/lib/v1/response";

/** v1 — public directory of groups opted into the tBook public listing. No API key required. */
export async function GET(request: Request) {
  return runV1(request, async () => {
    const listings = await listPublicDirectory();
    return { listings };
  });
}
