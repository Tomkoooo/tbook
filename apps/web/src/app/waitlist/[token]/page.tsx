import "@/lib/register-modules";
import type { Metadata } from "next";
import { ensureDbConnection } from "@tbook/db";
import { waitlist } from "@tbook/modules";
import { OfferPanel } from "./offer-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Várólista", robots: { index: false, follow: false } };

const TIME = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "long", timeStyle: "short" });

/** A waitlist offer, opened from the email link: take the held place or pass it on. */
export default async function WaitlistOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await ensureDbConnection();
  const offer = await waitlist.getOffer(token);

  let body: React.ReactNode;
  if (!offer) body = <p className="text-muted-foreground text-sm">Ez a link nem érvényes.</p>;
  else if (offer.status === "offered")
    body = (
      <>
        <p>
          Szia {offer.name}! Felszabadult {offer.guests > 1 ? `${offer.guests} hely` : "egy hely"}, és neked tartjuk
          {offer.expiresAt ? ` eddig: ${TIME.format(new Date(offer.expiresAt))}` : ""}.
        </p>
        <OfferPanel token={token} />
      </>
    );
  else if (offer.status === "registered") body = <p>Már regisztráltál, a visszaigazolást e-mailben küldtük.</p>;
  else if (offer.status === "expired") body = <p>Sajnos ez az ajánlat lejárt, a helyet továbbadtuk.</p>;
  else body = <p className="text-muted-foreground text-sm">Ez az ajánlat már nem él.</p>;

  return (
    <main className="mx-auto grid min-h-svh max-w-md place-items-center p-4">
      <div className="bg-card grid w-full gap-4 rounded-xl border p-6">
        <div className="grid gap-1">
          <p className="text-muted-foreground text-sm">Várólista</p>
          <h1 className="text-xl font-semibold">{offer?.eventName || "Esemény"}</h1>
        </div>
        {body}
      </div>
    </main>
  );
}
