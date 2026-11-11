import ExcelJS from "exceljs";
import { ActionError } from "@tbook/actions";
import { listAllVouchersForEventForOrg } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

const STATUS_LABELS: Record<string, string> = { active: "Nem érkezett meg", checked_in: "Megérkezett", void: "Érvénytelen" };

function budapestTime(date: Date | null | undefined): string {
  return date ? new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "short", timeStyle: "short" }).format(date) : "";
}

/** Arrivals list (.xlsx): every entry with its check-in status and time. */
export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  try {
    const { organizationId } = await requireOrgPermission("voucher:read");
    const { event, vouchers } = await listAllVouchersForEventForOrg(organizationId, eventId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Érkezések");
    sheet.columns = [
      { header: "Név", key: "name", width: 32 },
      { header: "Regisztrációs azonosító", key: "registrationNumber", width: 24 },
      { header: "Állapot", key: "status", width: 18 },
      { header: "Érkezés ideje", key: "checkedInAt", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const voucher of [...vouchers].sort((a, b) => a.displayName.localeCompare(b.displayName, "hu"))) {
      sheet.addRow({
        name: voucher.displayName,
        registrationNumber: voucher.registrationNumber ?? "",
        status: STATUS_LABELS[voucher.status] ?? voucher.status,
        checkedInAt: budapestTime(voucher.checkedInAt),
      });
    }
    const bytes = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(bytes as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${event.name.replace(/[^\w.-]+/g, "_")}-erkezesek.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[arrivals export]", error);
    return new Response("Could not build the export.", { status: 500 });
  }
}
