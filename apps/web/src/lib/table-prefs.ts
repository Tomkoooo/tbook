import { cookies } from "next/headers";
import { parseTablePrefs, tablePrefsCookie, type TablePrefs } from "@/components/data-table";

/** The viewer's saved columns / page size for a table, read on the server so the first paint is already right. */
export async function readTablePrefs(tableId: string): Promise<TablePrefs | undefined> {
  return parseTablePrefs((await cookies()).get(tablePrefsCookie(tableId))?.value);
}
