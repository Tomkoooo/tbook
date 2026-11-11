import { headers } from "next/headers";
import { checkRateLimit } from "@tbook/services";

/** Per-client limit for public (no-login) server actions. True when allowed. */
export async function allowPublicAction(scope: string, limit: number): Promise<boolean> {
  const h = await headers();
  const client = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return checkRateLimit(`${scope}:${client}`, limit, 60_000).allowed;
}
