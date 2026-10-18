// Passwortgeschützte Vereinsübersicht (Anmeldeformular, Passwort = ADMIN_PASSWORD)
//
// GET  /api/teilnehmer                          → Übersicht: Events, Summen, Auszahlungen
// GET  /api/teilnehmer?event=X                  → Teilnehmer eines Events mit Zahlungsstatus
// GET  /api/teilnehmer?event=X&format=csv       → dasselbe als CSV (Excel/Numbers)
// GET  /api/teilnehmer?export=kassenbuch[&jahr=2027] → Kassenbuch-CSV, eine Zeilengruppe pro Auszahlung
// POST /api/teilnehmer?action=sync              → Abgleich mit Stripe (Gebühren + Auszahlungen nachholen)
import type { Config } from "@netlify/functions";
import { events, findEvent, type GruppettoEvent } from "../../src/data/events";
import { listPayouts, syncRecent } from "../lib/accounting";
import { type Participant, type PayoutRecord, isActive, readLedger, seatsTaken } from "../lib/registrations";
import { env, escapeHtml as h, ledgerStore } from "../lib/services";
import { isTestMode } from "../lib/testmode";
import { simulateTestPayout } from "../lib/testmode-accounting";
import { type SiteSettings, readSettings, updateSettings } from "../lib/settings";

// ---------- Anmeldung ----------
// Login über ein normales Formular (funktioniert auch in der StackBlitz-Vorschau,
// wo Browser keine Passwort-Abfrage anzeigen). Danach merkt sich ein signiertes
// Cookie die Anmeldung für 12 Stunden. Basic-Auth (z. B. per curl) geht weiterhin.
const COOKIE = "gt_admin";
const SESSION_HOURS = 12;

function adminPassword(): string {
  // Im Testmodus (StackBlitz) ohne gesetztes Passwort: "test"
  return isTestMode() ? process.env.ADMIN_PASSWORD || "test" : env("ADMIN_PASSWORD");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(adminPassword()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`gruppetto-admin:${value}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sessionCookie(): Promise<string> {
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  // SameSite=None + Secure, damit es auch in der eingebetteten StackBlitz-Vorschau klappt
  return `${COOKIE}=${exp}.${await sign(String(exp))}; Path=/api/teilnehmer; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=None`;
}

async function authorized(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [, password = ""] = atob(header.slice(6)).split(/:(.*)/s);
    if (safeEqual(password, adminPassword())) return true;
  }
  const cookie = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) return false;
  const [exp, sig = ""] = cookie.slice(COOKIE.length + 1).split(".");
  if (!exp || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await sign(exp));
}

/** POST nur von der eigenen Seite annehmen (Schutz vor fremden Formularen). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return true; // manche Browser senden keinen Origin
  return origin === new URL(req.url).origin;
}

function loginPage(error?: string, status = 401) {
  return new Response(
    `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Anmelden · Gruppetto Verwaltung</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1e40;color:#f2f2f2;font:16px/1.45 Inter,system-ui,sans-serif;padding:16px}
form{width:min(360px,100%);background:#021859;padding:2rem 1.5rem;display:grid;gap:1rem}
h1{margin:0;font-size:1.5rem}p{margin:0;color:rgba(242,242,242,.72);font-size:.9rem}
label{display:grid;gap:.4rem;font-size:.9rem}
input{padding:.75rem .9rem;border:1px solid #04328c;background:#0d1e40;color:#f2f2f2;font:inherit}
input:focus{outline:2px solid #f2f2f2;outline-offset:1px}
button{padding:.85rem;border:0;background:#0f4abf;color:#f2f2f2;font:600 1rem Inter,system-ui,sans-serif;cursor:pointer}
.err{color:#ffb3a7}
</style>
<form method="post" action="?action=login">
  <h1>Verwaltung</h1>
  <p>Gruppetto Tübingen · Anmeldungen, Zahlungen, Website</p>
  ${error ? `<p class="err" role="alert">${h(error)}</p>` : ""}
  <label>Passwort<input type="password" name="password" autocomplete="current-password" required autofocus></label>
  <button>Anmelden</button>
</form></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

const eur = (cents: number) => (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (cents: number) => (cents / 100).toFixed(2).replace(".", ","); // für CSV
const dDate = (iso?: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const dTime = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const belegNr = (p: { id: string; arrivalDate: string }) => `ST-${p.arrivalDate}-${p.id.slice(-6).toUpperCase()}`;

function status(p: Participant): string {
  const r = p.refunded ?? 0;
  if (r >= p.amountPaid) return "erstattet";
  if (r > 0) return "teilw. erstattet";
  return "bezahlt";
}

const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(,\d+)?$/.test(s) ? `'${s}` : s; // Formel-Injection verhindern
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: (string | number)[][], filename: string) =>
  new Response("﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });

interface EventTotals {
  event: GruppettoEvent;
  participants: Participant[];
  active: number;
  refundedCount: number;
  gross: number;
  fees: number;
  refunds: number;
  net: number;
  paidOut: number;
  feesMissing: number;
  pending: number;
}

function totals(event: GruppettoEvent, paid: Participant[], pending: number): EventTotals {
  const t: EventTotals = { event, participants: paid, active: 0, refundedCount: 0, gross: 0, fees: 0, refunds: 0, net: 0, paidOut: 0, feesMissing: 0, pending };
  for (const p of paid) {
    if (isActive(p)) t.active++;
    if ((p.refunded ?? 0) > 0) t.refundedCount++;
    t.gross += p.amountPaid;
    t.fees += p.fee ?? 0;
    t.refunds += p.refunded ?? 0;
    if (p.fee === undefined) t.feesMissing++;
    if (p.payoutId) t.paidOut += p.net ?? p.amountPaid - (p.fee ?? 0);
  }
  t.net = t.gross - t.fees - t.refunds;
  return t;
}

async function loadAll() {
  const store = ledgerStore();
  const now = Date.now();
  const list = await Promise.all(
    events
      .filter((e) => e.registration)
      .map(async (e) => {
        const l = await readLedger(store, e.id, e.registration!.firstStartNumber);
        return totals(e, l.paid, seatsTaken(l, now) - l.paid.filter(isActive).length);
      }),
  );
  return list.sort((a, b) => b.event.dateISO.localeCompare(a.event.dateISO));
}

// ---------- Seiten ----------
const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${h(title)} · Gruppetto Verwaltung</title>
<style>
:root{--bg:#0d1e40;--alt:#021859;--line:#04328c;--text:#f2f2f2;--muted:rgba(242,242,242,.72);--acc:#f2f2f2;--blue:#0f4abf;--warn:#ffb3a7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 Inter,system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:2rem 1rem 4rem}a{color:var(--acc)}h1{margin:.2rem 0 1.5rem;font-size:1.8rem}h2{margin:2.5rem 0 .8rem;font-size:1.2rem}
.muted{color:var(--muted)}.kicker{color:var(--acc);font-weight:600;margin:0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.8rem;margin-bottom:1rem}
.card{background:var(--alt);border-radius:14px;padding:1rem}.card b{display:block;font-size:1.35rem;margin-top:.2rem}
.scroll{overflow-x:auto;border-radius:14px;background:var(--alt)}
table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{padding:.6rem .8rem;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:500}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
tfoot td{font-weight:700;border-top:1px solid var(--line)}
.tag{display:inline-block;padding:.1rem .55rem;border-radius:99px;font-size:.8rem;background:var(--blue);color:var(--text)}
.tag.ref{background:#3a2420;color:var(--warn)}.tag.wait{background:var(--line);color:var(--text)}
.actions{display:flex;flex-wrap:wrap;gap:.6rem;margin:0 0 1rem}
.btn{display:inline-block;border:0;border-radius:99px;padding:.55rem 1rem;background:var(--blue);color:var(--text);font:600 .9rem Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.sec{background:var(--alt);color:var(--text);border:1px solid var(--line)}
.note{background:var(--alt);border-left:3px solid var(--blue);border-radius:10px;padding:.7rem 1rem;margin:1rem 0}
.warn{border-left-color:var(--warn)}
.setting{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;background:var(--alt);border-radius:14px;padding:1rem}
</style><main>${body}</main></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

function overviewPage(all: EventTotals[], payouts: PayoutRecord[], settings: SiteSettings, flash?: string) {
  const sum = all.reduce((s, t) => ({ gross: s.gross + t.gross, fees: s.fees + t.fees, refunds: s.refunds + t.refunds, net: s.net + t.net }), { gross: 0, fees: 0, refunds: 0, net: 0 });
  // Tatsächlich überwiesen = Summe der Stripe-Auszahlungen (Erstattungen sind dort schon abgezogen)
  const onAccount = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const missing = all.reduce((s, t) => s + t.feesMissing, 0);
  const year = new Date().getFullYear();

  const eventRows = all
    .map(
      (t) => `<tr><td>${h(t.event.dateLabel)}</td><td><a href="?event=${encodeURIComponent(t.event.id)}">${h(t.event.title)}</a></td>
      <td class="r">${t.active} / ${t.event.registration!.capacity}${t.pending ? ` <span class="muted">(+${t.pending} in Bezahlung)</span>` : ""}</td>
      <td class="r">${t.refundedCount || ""}</td><td class="r">${eur(t.gross)}</td><td class="r">${eur(t.fees)}</td>
      <td class="r">${t.refunds ? eur(t.refunds) : ""}</td><td class="r"><b>${eur(t.net)}</b></td></tr>`,
    )
    .join("");

  const payoutRows = payouts
    .map((p) => {
      const parts = p.lines
        .map((l) => {
          const title = l.eventId === "sonstiges" ? "Sonstiges" : (findEvent(l.eventId)?.title ?? l.eventId);
          const bits = [l.payments ? `${l.payments}× Zahlung ${eur(l.gross)}` : "", l.refundCount ? `${l.refundCount}× Erstattung −${eur(l.refunds)}` : "", l.other ? `Sonstiges ${eur(l.other)}` : ""].filter(Boolean);
          return `${h(title)}: ${bits.join(", ")}, Gebühren −${eur(l.fees)}`;
        })
        .join("<br>");
      const check = p.lines.reduce((s, l) => s + l.gross - l.fees - l.refunds + l.other, 0);
      return `<tr><td>${dDate(p.arrivalDate)}</td><td>${belegNr(p)}</td><td class="r"><b>${eur(p.amount)}</b></td>
        <td style="white-space:normal">${parts || '<span class="muted">–</span>'}</td>
        <td>${p.status === "paid" ? (check === p.amount ? '<span class="tag">stimmt</span>' : `<span class="tag ref">Differenz ${eur(p.amount - check)}</span>`) : `<span class="tag ref">${h(p.status)}</span>`}</td></tr>`;
    })
    .join("");

  return page(
    "Übersicht",
    `<p class="kicker">Gruppetto Tübingen · Verwaltung · <a href="?action=logout">Abmelden</a></p><h1>Event-Anmeldungen & Zahlungen</h1>
${flash ? `<div class="note">${h(flash)}</div>` : ""}
${missing ? `<div class="note warn">Bei ${missing} Zahlung(en) fehlen noch die Stripe-Gebühren. Klick auf „Mit Stripe abgleichen“.</div>` : ""}
<div class="cards">
  <div class="card"><span class="muted">Einnahmen brutto</span><b>${eur(sum.gross)}</b></div>
  <div class="card"><span class="muted">Stripe-Gebühren</span><b>−${eur(sum.fees)}</b></div>
  <div class="card"><span class="muted">Erstattungen</span><b>−${eur(sum.refunds)}</b></div>
  <div class="card"><span class="muted">Netto</span><b>${eur(sum.net)}</b></div>
  <div class="card"><span class="muted">Davon schon auf dem Konto</span><b>${eur(onAccount)}</b></div>
</div>
<div class="actions">
  <form method="post" action="?action=sync"><button class="btn">${isTestMode() ? "🧪 Test-Auszahlung simulieren" : "Mit Stripe abgleichen"}</button></form>
  <a class="btn sec" href="?export=kassenbuch&jahr=${year}">Kassenbuch ${year} (CSV)</a>
  <a class="btn sec" href="?export=kassenbuch&jahr=${year - 1}">Kassenbuch ${year - 1} (CSV)</a>
</div>

<h2>Website</h2>
<div class="setting">
  <div><b>Off-Season</b> <span class="tag ${settings.offseason ? "" : "wait"}">${settings.offseason ? "aktiv" : "aus"}</span>
  <p class="muted" style="margin:.3rem 0 0">Zeigt auf der Rides-Seite „Season Closed“ über den Weekly Rides. Wirkt sofort, ohne neuen Deploy.</p></div>
  <form method="post" action="?action=offseason"><input type="hidden" name="value" value="${settings.offseason ? "off" : "on"}">
  <button class="btn ${settings.offseason ? "sec" : ""}">${settings.offseason ? "Off-Season beenden" : "Off-Season aktivieren"}</button></form>
</div>

<h2>Events</h2>
<div class="scroll"><table><thead><tr><th>Datum</th><th>Event</th><th class="r">Teilnehmer</th><th class="r">Erstattet</th><th class="r">Brutto</th><th class="r">Gebühren</th><th class="r">Erstattungen</th><th class="r">Netto</th></tr></thead>
<tbody>${eventRows || '<tr><td colspan="8" class="muted">Noch keine Events mit Anmeldung.</td></tr>'}</tbody></table></div>

<h2>Auszahlungen aufs Vereinskonto</h2>
<p class="muted">Jede Zeile entspricht einer Überweisung von Stripe auf dem Kontoauszug. Die Belegnummer könnt ihr im Kassenbuch verwenden.</p>
<div class="scroll"><table><thead><tr><th>Datum</th><th>Beleg</th><th class="r">Betrag</th><th>Aufschlüsselung</th><th>Abgleich</th></tr></thead>
<tbody>${payoutRows || '<tr><td colspan="5" class="muted">Noch keine Auszahlungen.</td></tr>'}</tbody></table></div>`,
  );
}

function eventPage(t: EventTotals) {
  const rows = [...t.participants]
    .sort((a, b) => a.startNumber - b.startNumber)
    .map((p) => {
      const st = status(p);
      return `<tr><td class="r"><b>${p.startNumber}</b></td><td>${h(p.name)}</td><td><a href="mailto:${h(p.email)}">${h(p.email)}</a></td>
      <td>${dTime(p.paidAt)}</td><td class="r">${eur(p.amountPaid)}</td><td class="r">${p.fee !== undefined ? eur(p.fee) : '<span class="muted">?</span>'}</td>
      <td class="r">${p.net !== undefined ? eur(p.net - (p.refunded ?? 0)) : ""}</td>
      <td><span class="tag ${st === "bezahlt" ? "" : "ref"}">${st}</span>${p.refunded ? ` <span class="muted">${eur(p.refunded)} am ${dDate(p.refundedAt)}</span>` : ""}</td>
      <td>${p.payoutId ? `${dDate(p.payoutDate)} <span class="muted">${belegNr({ id: p.payoutId, arrivalDate: p.payoutDate! })}</span>` : st === "erstattet" ? '<span class="muted">–</span>' : '<span class="tag wait">bei Stripe</span>'}</td>
      <td class="muted">${h(p.reservationId)}</td></tr>`;
    })
    .join("");
  return page(
    t.event.title,
    `<p class="kicker"><a href="?">← Übersicht</a></p><h1>${h(t.event.title)}</h1>
<p class="muted">${h(t.event.dateLabel)}, ${h(t.event.time)} · ${h(t.event.location)}</p>
<div class="cards">
  <div class="card"><span class="muted">Dabei</span><b>${t.active} / ${t.event.registration!.capacity}</b></div>
  <div class="card"><span class="muted">Brutto</span><b>${eur(t.gross)}</b></div>
  <div class="card"><span class="muted">Gebühren</span><b>−${eur(t.fees)}</b></div>
  <div class="card"><span class="muted">Erstattet</span><b>−${eur(t.refunds)}</b></div>
  <div class="card"><span class="muted">Netto</span><b>${eur(t.net)}</b></div>
</div>
<div class="actions"><a class="btn" href="?event=${encodeURIComponent(t.event.id)}&format=csv">Als CSV herunterladen</a></div>
<div class="scroll"><table><thead><tr><th class="r">Nr.</th><th>Name</th><th>E-Mail</th><th>Bezahlt am</th><th class="r">Betrag</th><th class="r">Gebühr</th><th class="r">Netto</th><th>Status</th><th>Auf dem Konto</th><th>Referenz</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10" class="muted">Noch keine Anmeldungen.</td></tr>'}</tbody>
<tfoot><tr><td></td><td colspan="3">Summe</td><td class="r">${eur(t.gross)}</td><td class="r">${eur(t.fees)}</td><td class="r">${eur(t.net)}</td><td colspan="3"></td></tr></tfoot></table></div>`,
  );
}

function eventCsv(t: EventTotals) {
  const rows: (string | number)[][] = [
    ["Startnummer", "Name", "E-Mail", "Status", "Bezahlt am", "Betrag (EUR)", "Stripe-Gebühr (EUR)", "Erstattet (EUR)", "Erstattet am", "Netto (EUR)", "Ausgezahlt am", "Beleg Auszahlung", "Referenz", "Stripe-Zahlung"],
    ...[...t.participants]
      .sort((a, b) => a.startNumber - b.startNumber)
      .map((p) => [
        p.startNumber,
        p.name,
        p.email,
        status(p),
        dTime(p.paidAt),
        num(p.amountPaid),
        p.fee !== undefined ? num(p.fee) : "",
        num(p.refunded ?? 0),
        dDate(p.refundedAt),
        num(p.amountPaid - (p.fee ?? 0) - (p.refunded ?? 0)),
        dDate(p.payoutDate),
        p.payoutId && p.payoutDate ? belegNr({ id: p.payoutId, arrivalDate: p.payoutDate }) : "",
        p.reservationId,
        p.paymentIntent ?? "",
      ]),
    [],
    ["Summe", "", "", `${t.active} aktiv`, "", num(t.gross), num(t.fees), num(t.refunds), "", num(t.net)],
  ];
  return csv(rows, `teilnehmer-${t.event.id}.csv`);
}

function kassenbuchCsv(payouts: PayoutRecord[], year?: string) {
  const rows: (string | number)[][] = [["Datum", "Belegnr.", "Beschreibung", "Kategorie", "Event", "Einnahme (EUR)", "Ausgabe (EUR)", "Stripe-Auszahlung"]];
  const selected = payouts
    .filter((p) => p.status === "paid" && (!year || p.arrivalDate.startsWith(year)))
    .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));
  for (const p of selected) {
    const beleg = belegNr(p);
    for (const l of p.lines) {
      const ev = l.eventId === "sonstiges" ? undefined : findEvent(l.eventId);
      const name = ev ? `${ev.title} (${ev.dateLabel})` : "nicht zugeordnet";
      if (l.gross) rows.push([dDate(p.arrivalDate), beleg, `Teilnahmegebühren ${name}, ${l.payments} Anmeldung(en)`, "Event-Einnahmen", ev?.title ?? "", num(l.gross), "", p.id]);
      if (l.refunds) rows.push([dDate(p.arrivalDate), beleg, `Erstattungen ${name}, ${l.refundCount}×`, "Erstattung Teilnahmegebühr", ev?.title ?? "", "", num(l.refunds), p.id]);
      if (l.fees) rows.push([dDate(p.arrivalDate), beleg, `Stripe-Gebühren ${name}`, "Zahlungsgebühren", ev?.title ?? "", "", num(l.fees), p.id]);
      if (l.other) rows.push([dDate(p.arrivalDate), beleg, "Sonstige Stripe-Posten", "Sonstiges", "", l.other > 0 ? num(l.other) : "", l.other < 0 ? num(-l.other) : "", p.id]);
    }
    rows.push(["", "", `Summe: Gutschrift auf Vereinskonto ${num(p.amount)} EUR`, "", "", "", "", ""]);
  }
  return csv(rows, `kassenbuch-stripe-${year ?? "alle"}.csv`);
}

// ---------- Handler ----------
export default async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (req.method === "POST" && !sameOrigin(req)) return new Response("Nicht erlaubt", { status: 403 });

  if (req.method === "POST" && action === "login") {
    const password = String((await req.formData()).get("password") ?? "");
    if (!safeEqual(password, adminPassword())) {
      await new Promise((r) => setTimeout(r, 800)); // Raten bremsen
      return loginPage("Falsches Passwort.");
    }
    return new Response(null, { status: 303, headers: { location: url.pathname, "set-cookie": await sessionCookie() } });
  }
  if (action === "logout") {
    return new Response(null, {
      status: 303,
      headers: { location: url.pathname, "set-cookie": `${COOKIE}=; Path=/api/teilnehmer; Max-Age=0; HttpOnly; Secure; SameSite=None` },
    });
  }
  if (!(await authorized(req))) return loginPage();

  const store = ledgerStore();

  if (req.method === "POST" && url.searchParams.get("action") === "offseason") {
    const value = (await req.formData()).get("value");
    const s = await updateSettings(store, { offseason: value === "on" });
    return overviewPage(await loadAll(), await listPayouts(store), s, s.offseason ? "Off-Season ist jetzt aktiv." : "Off-Season ist beendet – die Rides sind wieder sichtbar.");
  }
  const settings = await readSettings(store);

  if (req.method === "POST" && url.searchParams.get("action") === "sync") {
    let flash: string;
    try {
      if (isTestMode()) {
        const r = await simulateTestPayout(store);
        return overviewPage(
          await loadAll(),
          await listPayouts(store),
          settings,
          r.payouts
            ? `Testmodus: Auszahlung über ${(r.amount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} simuliert.`
            : "Testmodus: Nichts auszuzahlen – erst eine Testanmeldung bezahlen.",
        );
      }
      const r = await syncRecent(store);
      flash = `Abgleich fertig: ${r.feesFilled} Gebühr(en) nachgetragen, ${r.payouts} Auszahlung(en) verarbeitet.`;
    } catch (err) {
      console.error("Abgleich fehlgeschlagen", err);
      flash = "Abgleich fehlgeschlagen – bitte später erneut versuchen (Details im Netlify-Log).";
    }
    return overviewPage(await loadAll(), await listPayouts(store), settings, flash);
  }

  if (url.searchParams.get("export") === "kassenbuch") {
    return kassenbuchCsv(await listPayouts(store), url.searchParams.get("jahr") ?? undefined);
  }

  const eventId = url.searchParams.get("event");
  if (eventId) {
    const event = findEvent(eventId);
    if (!event?.registration) return new Response("Unbekanntes Event", { status: 404 });
    const t = (await loadAll()).find((x) => x.event.id === eventId)!;
    return url.searchParams.get("format") === "csv" ? eventCsv(t) : eventPage(t);
  }

  return overviewPage(await loadAll(), await listPayouts(store), settings);
};

export const config: Config = { path: "/api/teilnehmer" };
