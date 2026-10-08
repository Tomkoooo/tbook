// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BOOKING_STATUS_TONES, Badge, INVOICE_STATUS_TONES, VOUCHER_STATUS_TONES } from "./badge";
import { bookingStatuses, invoiceStatuses, voucherStatuses } from "@tbook/schemas";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>paid</Badge>);
    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("applies the requested tone class", () => {
    render(<Badge tone="danger">cancelled</Badge>);
    expect(screen.getByText("cancelled")).toHaveClass("tbook-badge-danger");
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>expired</Badge>);
    expect(screen.getByText("expired")).toHaveClass("tbook-badge-neutral");
  });
});

describe("status tone maps", () => {
  // These maps are what every surface uses to colour a status. A status
  // added to @tbook/schemas without a tone here would silently render as
  // undefined, so the coverage is asserted rather than assumed.
  it("covers every booking status", () => {
    for (const status of bookingStatuses) expect(BOOKING_STATUS_TONES[status]).toBeDefined();
  });

  it("covers every voucher status", () => {
    for (const status of voucherStatuses) expect(VOUCHER_STATUS_TONES[status]).toBeDefined();
  });

  it("covers every invoice status", () => {
    for (const status of invoiceStatuses) expect(INVOICE_STATUS_TONES[status]).toBeDefined();
  });

  it("marks a cancelled booking as dangerous and a paid one as successful", () => {
    expect(BOOKING_STATUS_TONES.cancelled).toBe("danger");
    expect(BOOKING_STATUS_TONES.paid).toBe("success");
  });
});
