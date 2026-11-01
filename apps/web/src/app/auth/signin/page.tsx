import { Mail } from "lucide-react";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Email magic-link sign-in. */
export const dynamic = "force-dynamic";

export default function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const { callbackUrl } = await searchParams;
    await signIn("nodemailer", { email, redirectTo: callbackUrl || "/admin" });
  }

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to tBook</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send you a one-time sign-in link.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={sendMagicLink} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" name="email" placeholder="you@example.com" required autoFocus />
            </div>
            <Button type="submit" className="w-full">
              <Mail /> Send sign-in link
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
