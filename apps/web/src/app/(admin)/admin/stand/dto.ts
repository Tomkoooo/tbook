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
  internal: number;
  /** opening + restocked − sold − internal */
  stock: number;
}

export interface StandDayDto {
  id: string;
  date: string;
  devices: boolean;
  lines: StandLineDto[];
}

export function toDayDto(day: Day): StandDayDto {
  return {
    id: String(day._id),
    date: day.date,
    devices: day.devices,
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
      stock: l.opening + l.restocked - l.soldCash - l.soldCard - l.internal,
    })),
  };
}
