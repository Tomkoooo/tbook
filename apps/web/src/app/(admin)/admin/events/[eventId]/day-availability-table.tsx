import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Read-only sales picture of a day-pass event: one row per day. */
export function DayAvailabilityTable({
  days,
  currency,
}: {
  days: Array<{ date: string; weekend: boolean; priceHuf: number; capacity: number | null; sold: number; remaining: number | null; closed: boolean }>;
  currency: string;
}) {
  if (days.length === 0) return null;
  const totalSold = days.reduce((sum, day) => sum + day.sold, 0);

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>Sales by day</CardTitle>
        <CardDescription>{totalSold} passes sold across {days.length} days.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Date</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Sold</TableHead>
              <TableHead className="pr-6">Left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.date} className={day.closed ? "opacity-50" : undefined}>
                <TableCell className="pl-6 tabular-nums">{day.date}</TableCell>
                <TableCell>{day.closed ? <Badge variant="secondary">closed</Badge> : day.weekend ? "Weekend" : "Weekday"}</TableCell>
                <TableCell className="tabular-nums">
                  {day.priceHuf.toLocaleString("hu-HU")} {currency}
                </TableCell>
                <TableCell className="tabular-nums">{day.sold}{day.capacity !== null ? ` / ${day.capacity}` : ""}</TableCell>
                <TableCell className="pr-6 tabular-nums">
                  {day.remaining === null ? "∞" : day.remaining === 0 ? <Badge variant="destructive">sold out</Badge> : day.remaining}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
