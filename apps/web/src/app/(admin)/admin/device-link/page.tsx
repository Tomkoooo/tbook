import { PageTitle } from "@/components/page-title";
import { DeviceLinkCard } from "./device-link-card";

export const dynamic = "force-dynamic";

export default function DeviceLinkPage() {
  return (
    <>
      <PageTitle title="Sign in another device" description="Show a QR code and scan it with a phone or tablet to sign that device in as you." />
      <DeviceLinkCard />
    </>
  );
}
