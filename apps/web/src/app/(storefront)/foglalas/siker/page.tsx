import { redirect } from "next/navigation";

/**
 * Stripe returns buyers to `<storefront>/foglalas/siker` (the path the
 * storefront plugins serve). When the storefront is tBook itself, forward
 * to tBook's own success page with the same query.
 */
export default async function LegacySuccessRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["bookingId", "session_id", "cancelled", "return_to"]) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  const suffix = query.toString();
  redirect(suffix ? `/book/success?${suffix}` : "/book/success");
}
