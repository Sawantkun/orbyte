import "server-only";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { NodeError } from "./engine/errors";

/** Gmail credentials: the address plus a Google app password (stored encrypted). */
export type GmailCredential = { user: string; pass: string };
export type Attachment = { filename: string; content: Buffer; contentType: string };
export type OutgoingEmail = { to: string[]; subject: string; text: string; html?: string; attachments?: Attachment[] };
export type SentEmail = { messageId: string; accepted: string[]; rejected: string[] };

export interface Mailer {
  /** "ok" when Gmail accepted the login, "auth" when it rejected it, "unreachable" otherwise. */
  verify(cred: GmailCredential): Promise<"ok" | "auth" | "unreachable">;
  send(cred: GmailCredential, email: OutgoingEmail, signal: AbortSignal): Promise<SentEmail>;
}

const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

/**
 * Gmail over SMTP (smtp.gmail.com, TLS). MAIL_TRANSPORT=json swaps in nodemailer's
 * JSON transport, which renders but never sends — used by automated tests.
 */
function transport(cred: GmailCredential) {
  if (env.MAIL_TRANSPORT === "json") return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({ service: "gmail", auth: { user: cred.user, pass: cred.pass }, ...TIMEOUTS });
}

const isAuthError = (e: unknown) => {
  const err = e as { code?: string; responseCode?: number };
  return err?.code === "EAUTH" || err?.responseCode === 535 || err?.responseCode === 534;
};

export const gmailMailer: Mailer = {
  async verify(cred) {
    if (env.MAIL_TRANSPORT === "json") return cred.pass.length >= 16 ? "ok" : "auth";
    try {
      await transport(cred).verify();
      return "ok";
    } catch (e) {
      return isAuthError(e) ? "auth" : "unreachable";
    }
  },

  async send(cred, email, signal) {
    if (signal.aborted) throw new NodeError("CANCELLED", "Cancelled", false);
    try {
      const info = await transport(cred).sendMail({
        from: cred.user,
        to: email.to,
        // Header injection guard: subjects are single-line.
        subject: email.subject.replace(/[\r\n]+/g, " ").slice(0, 300),
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.attachments?.length ? { attachments: email.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) } : {}),
      });
      const i = info as { messageId?: string; accepted?: unknown[]; rejected?: unknown[] };
      return { messageId: i.messageId ?? "", accepted: (i.accepted ?? email.to).map(String), rejected: (i.rejected ?? []).map(String) };
    } catch (e) {
      if (isAuthError(e)) throw new NodeError("EMAIL_AUTH", "Gmail rejected the login. Check the app password in Integrations.", false);
      // Not retried automatically: a partially failed send could otherwise deliver twice.
      throw new NodeError("EMAIL_FAILED", `Gmail couldn't send the email (${(e as { code?: string }).code ?? "error"}).`, false);
    }
  },
};
