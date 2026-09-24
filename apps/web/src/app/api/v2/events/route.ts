import { runAction } from "@/lib/api-response";

/**
 * v2 — new contract for the rebuilt frontend: org-scoped API keys (not
 * group-only), consistent { data, meta } envelope, cursor pagination.
 * Phase 4 fills this in against the same @tbook/services layer as v1.
 */
export async function GET() {
  return runAction(async () => {
    // TODO(phase-4): org-scoped auth, cursor pagination, @tbook/services call.
    return { data: [], meta: { nextCursor: null } };
  });
}
