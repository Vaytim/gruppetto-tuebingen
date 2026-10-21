// POST /api/kontakt – Kontaktformular im Footer jeder Seite.
// Die Nachricht geht per Mail an KONTAKT_EMPFAENGER (Netlify-Umgebungsvariable,
// ersatzweise an die Adresse unten). „Antworten“ geht direkt an die Person, die geschrieben hat.
// Versand über denselben SMTP-Zugang wie die Anmeldebestätigungen (SMTP_*, MAIL_FROM).
import type { Config } from "@netlify/functions";
import { escapeHtml as h, json, sendMail } from "../lib/services";

/** Empfänger, falls KONTAKT_EMPFAENGER nicht gesetzt ist */
const KONTAKT_EMPFAENGER = "";

const MAX = { name: 100, email: 200, message: 5000 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// Einfache Bremse gegen Spam: höchstens 5 Nachrichten pro IP und Stunde (pro Function-Instanz)
const recent = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 3600_000);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
}

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const data = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v ?? "")]));
  }
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "null" && origin !== new URL(req.url).origin) return json({ error: "Nicht erlaubt" }, 403);

  const body = await readBody(req);
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const message = (body.message ?? "").trim();
  const page = (body.page ?? "").trim().slice(0, 200);

  // Honeypot: Feld ist für Menschen unsichtbar – ist es ausgefüllt, war es ein Bot
  if (body.website) return json({ ok: true });
  // Zu schnell abgeschickt (unter 3 Sekunden nach dem Laden) → vermutlich Bot
  const startedAt = Number(body.t);
  if (startedAt && Date.now() - startedAt < 3000) return json({ ok: true });

  if (!name || !email || !message) return json({ error: "Bitte Name, E-Mail und Nachricht ausfüllen." }, 400);
  if (name.length > MAX.name || email.length > MAX.email || message.length > MAX.message)
    return json({ error: "Die Nachricht ist zu lang." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Bitte gib eine gültige E-Mail-Adresse an." }, 400);

  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for") ?? "?";
  if (tooMany(ip)) return json({ error: "Zu viele Nachrichten – bitte versuch es später noch einmal." }, 429);

  const to = process.env.KONTAKT_EMPFAENGER || KONTAKT_EMPFAENGER || (process.env.GRUPPETTO_TESTMODUS === "1" ? "kontakt@test.local" : "");
  if (!to) {
    console.error("Kontaktformular: KONTAKT_EMPFAENGER ist nicht gesetzt");
    return json({ error: "Das Kontaktformular ist gerade nicht erreichbar. Schreib uns gerne auf Instagram." }, 503);
  }

  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
  try {
    await sendMail({
      to,
      replyTo: `"${oneLine(name).replace(/"/g, "")}" <${email}>`,
      bcc: false,
      subject: `Kontaktformular: Nachricht von ${oneLine(name)}`,
      text: `Neue Nachricht über das Kontaktformular auf gruppetto-tuebingen.de\n\nName:   ${name}\nE-Mail: ${email}${page ? `\nSeite:  ${page}` : ""}\n\n${message}\n\n— Einfach auf diese Mail antworten, dann geht die Antwort direkt an ${email}.`,
      html: `<!doctype html><html lang="de"><body style="margin:0;background:#f2f2f2;font-family:Inter,Arial,sans-serif;color:#021859">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#04328c">Gruppetto Tübingen · Kontaktformular</p>
  <h1 style="margin:0 0 20px;font-size:22px">Nachricht von ${h(name)}</h1>
  <p style="margin:0 0 4px"><b>E-Mail:</b> <a href="mailto:${h(email)}" style="color:#0f4abf">${h(email)}</a></p>
  ${page ? `<p style="margin:0 0 16px;color:#04328c;font-size:14px">Gesendet von: ${h(page)}</p>` : ""}
  <div style="background:#fff;border-radius:12px;padding:18px;white-space:pre-wrap;line-height:1.5">${h(message)}</div>
  <p style="margin:20px 0 0;font-size:13px;color:#04328c">Einfach auf diese Mail antworten – die Antwort geht direkt an ${h(email)}.</p>
</div></body></html>`,
    });
  } catch (err) {
    console.error("Kontaktformular: Versand fehlgeschlagen", err);
    return json({ error: "Die Nachricht konnte nicht verschickt werden. Bitte versuch es später noch einmal." }, 502);
  }
  return json({ ok: true });
};

export const config: Config = { path: "/api/kontakt" };
