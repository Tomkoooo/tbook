import { signIn } from "@/auth";

/**
 * Minimal functional sign-in page — email magic link only. Styling/UX
 * polish is a later frontend phase; this just needs to work.
 */
export const dynamic = "force-dynamic";

export default function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const { callbackUrl } = await searchParams;
    await signIn("nodemailer", { email, redirectTo: callbackUrl || "/admin" });
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign in to tBook</h1>
      <p>Enter your email and we&apos;ll send you a one-time sign-in link.</p>
      <form action={sendMagicLink}>
        <input type="email" name="email" placeholder="you@example.com" required autoFocus style={{ width: "100%", padding: 8, marginBottom: 12 }} />
        <button type="submit" style={{ width: "100%", padding: 8 }}>
          Send sign-in link
        </button>
      </form>
    </main>
  );
}
