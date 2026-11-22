import Link from "next/link";
import { Button } from "@/components/ui/button";
import { eventPath } from "@/lib/event-routes";

const TABS = [
  { sub: undefined, label: "Pult", key: "sell" },
  { sub: "products", label: "Termékek", key: "products" },
  { sub: "safe", label: "Belső kassza", key: "safe" },
  { sub: "stats", label: "Statisztika", key: "stats" },
] as const;

export function StandTabs({ active, eventId, manage }: { active: (typeof TABS)[number]["key"]; eventId: string; manage: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.filter((t) => manage || t.key === "sell").map((tab) => (
        <Button key={tab.key} asChild variant={tab.key === active ? "default" : "outline"} size="sm">
          <Link href={eventPath(eventId, "stand", ...(tab.sub ? [tab.sub] : []))}>{tab.label}</Link>
        </Button>
      ))}
    </div>
  );
}
