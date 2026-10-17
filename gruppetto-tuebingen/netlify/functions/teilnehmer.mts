// GET /api/teilnehmer                → Übersicht aller Events (passwortgeschützt)
// GET /api/teilnehmer?event=X        → CSV-Teilnehmerliste zum Öffnen in Excel/Numbers
// Der Browser fragt nach Benutzer/Passwort: Benutzer beliebig, Passwort = ADMIN_PASSWORD.
import type { Config } from "@netlify/functions";
import { events, findEvent } from "../../src/data/events";
import { readLedger, seatsTaken } from "../lib/registrations";
import { env, escapeHtml, ledgerStore } from "../lib/services";
import { isTestMode } from "../lib/testmode";

function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const [, password = ""] = atob(header.slice(6)).split(/:(.*)/s);
  // Im Testmodus (StackBlitz) ohne gesetztes Passwort: "test"
  const expected = isTestMode() ? process.env.ADMIN_PASSWORD || "test" : env("ADMIN_PASSWORD");
  // Zeitkonstanter Vergleich
  if (password.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= password.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Schutz vor Formel-Injection in Excel
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export default async (req: Request) => {
  if (!authorized(req)) {
    return new Response("Anmeldung erforderlich", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="Gruppetto Teilnehmer", charset="UTF-8"' },
    });
  }
  const store = ledgerStore();
  const eventId = new URL(req.url).searchParams.get("event");

  if (eventId) {
    const event = findEvent(eventId);
    if (!event?.registration) return new Response("Unbekanntes Event", { status: 404 });
    const ledger = await readLedger(store, event.id, event.registration.firstStartNumber);
    const rows = [
      ["Startnummer", "Name", "E-Mail", "Betrag (EUR)", "Bezahlt am", "Referenz", "Stripe-Zahlung", "Mail verschickt"],
      ...[...ledger.paid]
        .sort((a, b) => a.startNumber - b.startNumber)
        .map((p) => [
          p.startNumber,
          p.name,
          p.email,
          (p.amountPaid / 100).toFixed(2).replace(".", ","),
          new Date(p.paidAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }),
          p.reservationId,
          p.paymentIntent ?? "",
          p.mailSent ? "ja" : "nein",
        ]),
    ];
    // Semikolon + BOM, damit Excel (deutsch) Umlaute und Spalten richtig erkennt
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="teilnehmer-${event.id}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const now = Date.now();
  const items = await Promise.all(
    events
      .filter((e) => e.registration)
      .map(async (e) => {
        const ledger = await readLedger(store, e.id, e.registration!.firstStartNumber);
        const sum = ledger.paid.reduce((s, p) => s + p.amountPaid, 0) / 100;
        return `<tr><td>${escapeHtml(e.dateLabel)}</td><td>${escapeHtml(e.title)}</td>
          <td>${ledger.paid.length} bezahlt · ${seatsTaken(ledger, now) - ledger.paid.length} in Bezahlung · ${e.registration!.capacity} Plätze</td>
          <td>${sum.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</td>
          <td><a href="?event=${encodeURIComponent(e.id)}">CSV herunterladen</a></td></tr>`;
      }),
  );
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Teilnehmer · Gruppetto</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;background:#0f1210;color:#f2f4f1}a{color:#d7f542}
table{border-collapse:collapse;width:100%}td,th{padding:.6rem .8rem;border-bottom:1px solid #2a302b;text-align:left}</style>
<h1>Event-Anmeldungen</h1>
<table><tr><th>Datum</th><th>Event</th><th>Anmeldungen</th><th>Einnahmen (brutto)</th><th></th></tr>${items.join("")}</table>
<p style="color:#a9b0aa">Einnahmen vor Stripe-Gebühren. Die genauen Gebühren stehen im Stripe-Dashboard unter Auszahlungen.</p>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/teilnehmer" };
