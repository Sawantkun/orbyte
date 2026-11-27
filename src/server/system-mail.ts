import "server-only";
import { env } from "@/lib/env";
import { gmailMailer } from "./mail";

/**
 * Account emails (verification, password reset) sent by Orbyte itself, from the
 * Gmail account in SYSTEM_MAIL_USER / SYSTEM_MAIL_PASSWORD. Without those (local
 * development) the email is printed to the server console instead, so the links
 * still work. Tests read the in-memory outbox (MAIL_TRANSPORT=json).
 */
export type SystemEmail = { to: string; subject: string; text: string; html: string };

export const testOutbox: SystemEmail[] = [];

/** Whether account emails can actually reach people (configured sender, or the test outbox). */
export const accountEmailEnabled = () => env.MAIL_TRANSPORT === "json" || Boolean(env.SYSTEM_MAIL_USER && env.SYSTEM_MAIL_PASSWORD);

export async function sendSystemEmail(email: SystemEmail): Promise<void> {
  if (env.MAIL_TRANSPORT === "json") {
    testOutbox.push(email);
    return;
  }
  if (!env.SYSTEM_MAIL_USER || !env.SYSTEM_MAIL_PASSWORD) {
    if (env.NODE_ENV === "production") {
      console.error("[mail] SYSTEM_MAIL_USER / SYSTEM_MAIL_PASSWORD are not set; account email not sent", { subject: email.subject });
      return;
    }
    console.info(`\n[mail] (dev, not sent) To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
    return;
  }
  try {
    await gmailMailer.send({ user: env.SYSTEM_MAIL_USER, pass: env.SYSTEM_MAIL_PASSWORD }, { to: [email.to], subject: email.subject, text: email.text, html: email.html }, AbortSignal.timeout(30_000));
  } catch (e) {
    // Never surface delivery details to the requester (avoids account enumeration).
    console.error("[mail] account email failed", { subject: email.subject, error: (e as Error).message });
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A short, plain account email with one button. */
export function accountEmail(opts: { to: string; name: string; subject: string; intro: string; action: string; url: string; outro: string }): SystemEmail {
  const text = `Hi ${opts.name},\n\n${opts.intro}\n\n${opts.action}: ${opts.url}\n\n${opts.outro}\n\n— Orbyte`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:480px">
<p>Hi ${escape(opts.name)},</p><p>${escape(opts.intro)}</p>
<p><a href="${escape(opts.url)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${escape(opts.action)}</a></p>
<p style="color:#555;font-size:13px">${escape(opts.outro)}</p><p style="color:#555;font-size:13px">— Orbyte</p></div>`;
  return { to: opts.to, subject: opts.subject, text, html };
}
