import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { getHotelForOrg, getOrganizationSettings, listGroupsForOrg } from "@tbook/services";
import { normalizeHotelPricing } from "@tbook/domain";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { HotelForm, type HotelFormValues } from "./hotel-form";

export const dynamic = "force-dynamic";

export default async function HotelPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const isNew = hotelId === "new";
  const { organizationId, permissions } = await requireAdminPage(isNew ? "hotel:write" : "hotel:read");

  const groups = (await listGroupsForOrg(organizationId)).map((group) => ({ id: String(group._id), name: group.name }));

  if (isNew) {
    const { currency: orgCurrency } = await getOrganizationSettings(organizationId);
    const initial: HotelFormValues = {
      groupId: groups[0]?.id ?? "",
      name: "",
      description: "",
      address: "",
      distanceFromVenueKm: null,
      contactEmail: "",
      contactPhone: "",
      currency: orgCurrency,
      bookingCapacity: null,
      roomInventory: null,
      status: "draft",
      priceBasis: "net",
      vatPercent: 27,
      roomTypes: [],
      packages: [],
    };
    return (
      <>
        <PageTitle title="New hotel" />
        <HotelForm hotelId={null} initial={initial} groups={groups} />
      </>
    );
  }

  const hotel = await getHotelForOrg(organizationId, hotelId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!hotel) notFound();

  if (!permissions.has("hotel:write")) {
    return <PageTitle title={hotel.name} description="You have read-only access to this hotel." />;
  }

  // Legacy flat pricing is migrated to room types/packages on read, so the
  // form always edits the modern shape.
  const pricing = normalizeHotelPricing(hotel.pricing);

  return (
    <>
      <PageTitle title={hotel.name} />
      <HotelForm
        hotelId={hotelId}
        groups={groups}
        initial={{
          groupId: hotel.groupId ? String(hotel.groupId) : "",
          name: hotel.name,
          description: hotel.description ?? "",
          address: hotel.address ?? "",
          distanceFromVenueKm: hotel.distanceFromVenueKm ?? null,
          contactEmail: hotel.contactEmail ?? "",
          contactPhone: hotel.contactPhone ?? "",
          currency: hotel.currency,
          bookingCapacity: hotel.bookingCapacity ?? null,
          roomInventory: hotel.roomInventory ?? null,
          status: hotel.status,
          priceBasis: pricing.priceBasis ?? "net",
          vatPercent: pricing.vatPercent ?? 27,
          roomTypes: (pricing.roomTypes ?? []).map((r) => ({ key: r.key, label: r.label, baseRateHuf: r.baseRateHuf, sortOrder: r.sortOrder ?? 0 })),
          packages: (pricing.packages ?? []).map((p) => ({
            key: p.key,
            label: p.label,
            nights: p.nights,
            priceHuf: p.priceHuf,
            maxGuests: p.maxGuests ?? null,
            inventoryUnits: p.inventoryUnits ?? null,
            roomTypeKey: p.roomTypeKey ?? null,
            sortOrder: p.sortOrder ?? 0,
          })),
        }}
      />
    </>
  );
}
