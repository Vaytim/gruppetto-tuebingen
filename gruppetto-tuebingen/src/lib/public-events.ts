// Gemeinsame Logik für Events-Seite und Startseite (läuft im Build UND im Browser).
import { events as codeEvents, registrationClosesAt } from "../data/events";

export interface PublicEvent {
  id: string;
  title: string;
  dateISO: string;
  dateLabel: string;
  time: string;
  location: string;
  level: string;
  description: string;
  image: string;
  strava?: string;
  registration?: { price: number; closesAt: string };
}

/** Fallback ohne Backend: nur die Events aus dem Code */
export function codeEventsPublic(): PublicEvent[] {
  return codeEvents
    .map(({ registration, ...e }) => ({
      ...e,
      registration: registration ? { price: registration.price, closesAt: registrationClosesAt({ ...e, registration }).toISOString() } : undefined,
    }))
    .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
}

/** Heutiges Datum in Tübingen als YYYY-MM-DD */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

/** Kommende Events (ab dem nächsten, aufsteigend) + die letzten 4 vergangenen (neueste zuerst) */
export function splitEvents(all: PublicEvent[], today = todayISO()) {
  const sorted = all.slice().sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  const upcoming = sorted.filter((e) => e.dateISO >= today);
  const past = sorted.filter((e) => e.dateISO < today).reverse().slice(0, 4);
  return { upcoming, past };
}

export async function fetchEvents(): Promise<PublicEvent[] | null> {
  try {
    const res = await fetch("/api/events", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export const formatEuro = (amount: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);

export function esc(s: string | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Nur http(s)-Links zulassen */
export function safeUrl(u: string | undefined): string {
  return u && /^https?:\/\//i.test(u) ? u : "";
}

/** Eine Event-Karte (Events-Seite). Vergangene Events: ohne Anmeldung, gedämpft. */
export function eventCardHTML(e: PublicEvent, past = false): string {
  const strava = safeUrl(e.strava);
  const r = !past && e.registration;
  const actions =
    r || strava
      ? `<div class="event-card-actions">
  ${
    r
      ? `<button type="button" class="btn-register" data-event-id="${esc(e.id)}" data-event-title="${esc(e.title)}"
      data-event-date="${esc(`${e.dateLabel} · ${e.time}`)}" data-event-price="${esc(formatEuro(r.price))}"
      data-closes-at="${esc(r.closesAt)}" disabled>Anmelden · ${esc(formatEuro(r.price))}</button>
    <p class="seats" data-seats-for="${esc(e.id)}">Plätze werden geladen …</p>`
      : ""
  }
  ${strava ? `<a class="btn-strava" href="${esc(strava)}" target="_blank" rel="noopener">${past ? "Aktivität auf Strava" : "Auf Strava ansehen"} ↗</a>` : ""}
</div>`
      : "";
  return `<article class="event-card${past ? " is-past" : ""}" tabindex="0">
  <div class="event-card-front">
    <p class="event-date">${esc(e.dateLabel)}${e.time ? ` &middot; ${esc(e.time)}` : ""}</p>
    <h3>${esc(e.title)}</h3>
    ${e.location ? `<p class="event-location">${esc(e.location)}</p>` : ""}
    ${e.level ? `<p class="event-level">${esc(e.level)}</p>` : ""}
  </div>
  <div class="event-card-reveal${e.image ? "" : " no-image"}">
    ${e.image ? `<img src="${esc(e.image)}" alt="${esc(e.title)}" loading="lazy" />` : ""}
    <div class="event-card-reveal-text"><p>${esc(e.description)}</p></div>
  </div>
  ${actions}
</article>`;
}

/** Eine Karte im Events-Slider der Startseite */
export function slideHTML(e: PublicEvent, past = false): string {
  return `<article class="slide${past ? " is-past" : ""}">
  ${e.image ? `<img src="${esc(e.image)}" alt="" loading="lazy" />` : `<div class="slide-noimg" aria-hidden="true"></div>`}
  <h3><a href="/events">${esc(e.title)}</a></h3>
  <p class="slide-meta">${past ? "Vergangen · " : ""}${esc(e.dateLabel)}${e.time ? ` · ${esc(e.time)}` : ""}</p>
  <p>${esc(e.description)}</p>
</article>`;
}

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
};
