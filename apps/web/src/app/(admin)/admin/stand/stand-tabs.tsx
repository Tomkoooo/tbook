import Link from "next/link";
import { Button } from "@/components/ui/button";

const TABS = [
  { href: "/admin/stand", label: "Pult", key: "sell" },
  { href: "/admin/stand/products", label: "Termékek", key: "products" },
  { href: "/admin/stand/stats", label: "Statisztika", key: "stats" },
] as const;

export function StandTabs({ active, eventId, manage }: { active: (typeof TABS)[number]["key"]; eventId: string; manage: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.filter((t) => manage || t.key === "sell").map((tab) => (
        <Button key={tab.key} asChild variant={tab.key === active ? "default" : "outline"} size="sm">
          <Link href={`${tab.href}?eventId=${eventId}`}>{tab.label}</Link>
        </Button>
      ))}
    </div>
  );
}
