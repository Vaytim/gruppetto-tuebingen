import type { GruppettoEvent } from "../../src/data/events";
import type { Participant } from "./registrations";
import { escapeHtml } from "./services";

const euro = (cents: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);

const berlinDate = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));

export function confirmationMail(event: GruppettoEvent, p: Participant) {
  const firstName = p.name.split(" ")[0] || p.name;
  const subject = `Startnummer ${p.startNumber} · ${event.title}`;

  const text = `Hallo ${firstName},

deine Anmeldung ist bestätigt und deine Zahlung ist bei uns eingegangen.

  Startnummer:    ${p.startNumber}
  Event:          ${event.title}
  Datum:          ${event.dateLabel}, ${event.time}
  ${event.location}

Zahlungseingang
  Betrag:         ${euro(p.amountPaid)}
  Bezahlt am:     ${berlinDate(p.paidAt)} Uhr
  Referenz:       ${p.reservationId}

Bitte bring deine Startnummer zum Event mit (einfach diese Mail zeigen).

Bis bald auf der Straße!
Gruppetto Tübingen
`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#04328c">${label}</td><td style="padding:4px 0;font-weight:600">${value}</td></tr>`;

  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f2f2f2;font-family:Inter,Arial,sans-serif;color:#021859">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#04328c">Gruppetto Tübingen</p>
  <h1 style="margin:0 0 20px;font-size:24px">Du bist dabei, ${escapeHtml(firstName)}!</h1>
  <div style="background:#021859;color:#f2f2f2;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px">
    <p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#f2f2f2;opacity:.75">Deine Startnummer</p>
    <p style="margin:4px 0 0;font-size:56px;font-weight:800;color:#f2f2f2;line-height:1.1">${p.startNumber}</p>
  </div>
  <table style="border-collapse:collapse;font-size:15px;margin-bottom:20px">
    ${row("Event", escapeHtml(event.title))}
    ${row("Datum", `${escapeHtml(event.dateLabel)}, ${escapeHtml(event.time)}`)}
    ${row("Ort", escapeHtml(event.location.replace(/^Treffpunkt:\s*/, "")))}
  </table>
  <h2 style="font-size:16px;margin:0 0 8px">Zahlungseingang bestätigt</h2>
  <table style="border-collapse:collapse;font-size:15px;margin-bottom:24px">
    ${row("Betrag", euro(p.amountPaid))}
    ${row("Bezahlt am", `${berlinDate(p.paidAt)} Uhr`)}
    ${row("Referenz", `<span style="font-family:monospace;font-weight:400">${escapeHtml(p.reservationId)}</span>`)}
  </table>
  <p style="margin:0 0 24px;line-height:1.5">Zeig diese Mail einfach beim Treffpunkt vor. Bei Fragen antworte direkt auf diese Nachricht.</p>
  <p style="margin:0;color:#04328c;font-size:13px">Keep it simple. Ride together.</p>
</div></body></html>`;

  return { subject, text, html };
}
