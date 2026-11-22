import { redirect } from "next/navigation";
import { SignedInHome } from "@/components/home/signed-in-home";
import { SignedOutHome } from "@/components/home/signed-out-home";
import { loadHome } from "@/components/home/load-home";
import { getSessionUser } from "@/lib/admin-auth";

/**
 * The public opening page. Signed out: a short sign-in page with a guide for
 * everyone who shouldn't be here (captains, kiosks, guests). Signed in: the
 * member's organization, today's events and the shortcuts their role can use
 * — the installed app starts here too. Reads no data for a visitor.
 */
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const user = await getSessionUser();
  if (!user) return <SignedOutHome />;

  const state = await loadHome(user);
  const { org } = await searchParams;
  const autoSelectTried = org === "auto";

  // One organization and none remembered: /auth/pick-org remembers it (a page can't set cookies) and comes back.
  if (state.kind === "auto-select" && !autoSelectTried) redirect("/auth/pick-org");

  return <SignedInHome state={state} email={user.email} autoSelectFailed={autoSelectTried} />;
}
