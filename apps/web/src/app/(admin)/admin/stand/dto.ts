import type { stand } from "@tbook/modules";

type Day = Awaited<ReturnType<typeof stand.getDay>> & object;

export interface StandLineDto {
  productId: string;
  name: string;
  category: "drink" | "food";
  priceHuf: number;
  depositHuf: number;
  image: string;
  opening: number;
  restocked: number;
  soldCash: number;
  soldCard: number;
  /** Internal use from the stand's stock. */
  internal: number;
  /** Internal use outside the stand (stock untouched). */
  internalOutside: number;
  /** opening + restocked − sold − internal */
  stock: number;
}

export interface StandDayDto {
  id: string;
  date: string;
  devices: boolean;
  /** Practice day: not in stats or inventory. */
  sandbox: boolean;
  /** Nyitó váltó. */
  floatHuf: number;
  lines: StandLineDto[];
}

export function toDayDto(day: Day): StandDayDto {
  return {
    id: String(day._id),
    date: day.date,
    devices: day.devices,
    sandbox: day.sandbox,
    floatHuf: day.floatHuf ?? 0,
    lines: day.lines.map((l) => ({
      productId: String(l.productId),
      name: l.name,
      category: l.category,
      priceHuf: l.priceHuf,
      depositHuf: l.depositHuf,
      image: l.image,
      opening: l.opening,
      restocked: l.restocked,
      soldCash: l.soldCash,
      soldCard: l.soldCard,
      internal: l.internal,
      internalOutside: l.internalOutside ?? 0,
      stock: l.opening + l.restocked - l.soldCash - l.soldCard - l.internal,
    })),
  };
}
