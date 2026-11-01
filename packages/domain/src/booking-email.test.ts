import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOKING_EMAIL_TEMPLATE,
  describeBookingEmailAttachments,
  fillBookingEmailPlaceholders,
  isBlankEmailBody,
  renderBookingEmail,
  resolveBookingEmailTemplate,
} from "./booking-email";

describe("fillBookingEmailPlaceholders", () => {
  it("escapes values in the HTML body but not in the subject", () => {
    const values = { customerName: "<b>Anna</b> & co" };
    expect(fillBookingEmailPlaceholders("Hi {{customerName}}", values, "html")).toBe("Hi &lt;b&gt;Anna&lt;/b&gt; &amp; co");
    expect(fillBookingEmailPlaceholders("Hi {{ customerName }}", values, "text")).toBe("Hi <b>Anna</b> & co");
  });

  it("leaves unknown placeholders visible", () => {
    expect(fillBookingEmailPlaceholders("{{nope}} {{eventName}}", { eventName: "Open" }, "text")).toBe("{{nope}} Open");
  });

  it("renders null values as empty text", () => {
    expect(fillBookingEmailPlaceholders("[{{eventDate}}]", { eventDate: null }, "html")).toBe("[]");
  });
});

describe("resolveBookingEmailTemplate", () => {
  it("falls back per field and treats an empty editor body as blank", () => {
    const resolved = resolveBookingEmailTemplate({ subject: "", body: "<p></p>" }, { subject: "Legacy", body: "<p>Old</p>" });
    expect(resolved).toEqual({ subject: "Legacy", body: "<p>Old</p>" });
    expect(resolveBookingEmailTemplate(null, undefined)).toEqual(DEFAULT_BOOKING_EMAIL_TEMPLATE);
  });

  it("detects blank bodies", () => {
    expect(isBlankEmailBody("<p>&nbsp;</p>")).toBe(true);
    expect(isBlankEmailBody("<p>x</p>")).toBe(false);
  });
});

describe("renderBookingEmail", () => {
  it("renders the default template with no leftover tokens", () => {
    const values = {
      customerName: "Anna",
      eventName: "Open",
      total: "10 000 HUF",
      attachments: describeBookingEmailAttachments(2, true),
      organizationName: "MDSZ",
    };
    const out = renderBookingEmail(DEFAULT_BOOKING_EMAIL_TEMPLATE, values);
    expect(out.subject).toBe("Your booking for Open");
    expect(out.body).toContain("your 2 tickets and your invoice");
    expect(out.body).not.toMatch(/\{\{/);
  });
});

describe("describeBookingEmailAttachments", () => {
  it("phrases every combination", () => {
    expect(describeBookingEmailAttachments(1, false)).toBe("your ticket");
    expect(describeBookingEmailAttachments(0, true)).toBe("your invoice");
    expect(describeBookingEmailAttachments(0, false)).toBe("your booking details");
  });
});
