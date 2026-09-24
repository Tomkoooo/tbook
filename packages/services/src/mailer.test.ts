import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailTransporter } from "./mailer";
import { sendMail } from "./mailer";

describe("sendMail", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_PORT = "465";
    process.env.EMAIL_USER = "noreply@example.com";
    process.env.EMAIL_PASS = "secret";
    process.env.EMAIL_FROM = "noreply@example.com";
    process.env.EMAIL_FROM_NAME = "tBook";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("sends via the platform SMTP config when no org is given, using an injected transporter", async () => {
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    const transporter: MailTransporter = { sendMail: sendMailMock };

    await sendMail(null, { to: "guest@example.com", subject: "Your ticket", html: "<p>Hi</p>" }, transporter);

    expect(sendMailMock).toHaveBeenCalledOnce();
    const call = sendMailMock.mock.calls[0]![0];
    expect(call.to).toBe("guest@example.com");
    expect(call.from).toContain("noreply@example.com");
  });

  it("attaches files when provided", async () => {
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    const transporter: MailTransporter = { sendMail: sendMailMock };

    await sendMail(
      null,
      { to: "guest@example.com", subject: "Your ticket", html: "<p>Hi</p>", attachments: [{ filename: "voucher.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }] },
      transporter,
    );

    const call = sendMailMock.mock.calls[0]![0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toBe("voucher.pdf");
  });

  it("throws when neither org nor platform SMTP is configured", async () => {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    await expect(sendMail(null, { to: "guest@example.com", subject: "x", html: "x" })).rejects.toThrow(/No SMTP configuration/);
  });
});
