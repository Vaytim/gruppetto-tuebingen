import Stripe from "stripe";
import { getStore } from "@netlify/blobs";
import nodemailer, { type Transporter } from "nodemailer";
import type { LedgerStore } from "./registrations";
import { isTestMode, memoryStore, testOutbox } from "./testmode";

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt (Netlify → Site configuration → Environment variables)`);
  return value;
}

let stripeClient: Stripe | undefined;
export function stripe(): Stripe {
  stripeClient ??= new Stripe(env("STRIPE_SECRET_KEY"));
  return stripeClient;
}

export function ledgerStore(): LedgerStore {
  if (isTestMode()) return memoryStore;
  // "strong", damit direkt nach einem Schreiben der neue Stand gelesen wird.
  return getStore({ name: "event-registrations", consistency: "strong" }) as unknown as LedgerStore;
}

/** Öffentliche Adresse der Website, z. B. https://gruppetto-tuebingen.de */
export function siteUrl(req: Request): string {
  return process.env.SITE_URL ?? process.env.URL ?? new URL(req.url).origin;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

let transport: Transporter | undefined;
export function mailer(): Transporter {
  transport ??= nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });
  return transport;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Anmelde-Referenz, nur für die Test-Postfach-Ansicht */
  ref?: string;
  /** Antwort-Adresse (z. B. Absender des Kontaktformulars) */
  replyTo?: string;
  /** false = keine BCC-Kopie an MAIL_BCC */
  bcc?: false;
}

/** Verschickt eine Mail – im Testmodus landet sie stattdessen im Test-Postfach. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (isTestMode()) {
    testOutbox.unshift({ ...mail, sentAt: new Date().toISOString() });
    console.log(`[Testmodus] Mail an ${mail.to}: ${mail.subject}`);
    return;
  }
  const { ref: _ref, replyTo, bcc, ...content } = mail;
  await mailer().sendMail({
    from: env("MAIL_FROM"),
    replyTo: replyTo || process.env.MAIL_REPLY_TO || undefined,
    bcc: bcc === false ? undefined : process.env.MAIL_BCC || undefined,
    ...content,
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
