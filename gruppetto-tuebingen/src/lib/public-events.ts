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
  /** Link zum Instagram-Reel */
  reelUrl?: string;
  /** Reel-Video (spielt stumm ab, sobald die Karte im Fokus ist) */
  reelVideo?: string;
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

/** Kommende Events (ab dem nächsten, aufsteigend) + vergangene (neueste zuerst, standardmäßig die letzten 4) */
export function splitEvents(all: PublicEvent[], pastLimit = 4, today = todayISO()) {
  const sorted = all.slice().sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  const upcoming = sorted.filter((e) => e.dateISO >= today);
  const past = sorted.filter((e) => e.dateISO < today).reverse().slice(0, pastLimit);
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

export const eventAnchor = (id: string) => `event-${id}`;

/**
 * Ein Event-Block im Slider-Stil (Startseite + Events-Seite).
 * mode "home":   Bild + Titel verlinken auf das Event auf der Events-Seite
 * mode "detail": Events-Seite – mit Treffpunkt, Level, Anmeldung und Strava-Link
 */
export function slideHTML(e: PublicEvent, opts: { past?: boolean; mode?: "home" | "detail" } = {}): string {
  const { past = false, mode = "home" } = opts;
  const link = `/events#${eventAnchor(e.id)}`;
  const video = e.reelVideo && e.reelVideo.startsWith("/api/event-video?") ? e.reelVideo : "";
  const media =
    (e.image ? `<img src="${esc(e.image)}" alt="" loading="lazy" />` : `<span class="slide-noimg"></span>`) +
    (video ? `<video class="slide-reel" muted loop playsinline preload="none" data-src="${esc(video)}" aria-hidden="true"></video><span class="reel-badge">▶ Reel</span>` : "");
  const reel = safeUrl(e.reelUrl);
  const cls = `slide${past ? " is-past" : ""}${video ? " has-reel" : ""}`;
  const meta = `${esc(e.dateLabel)}${e.time ? ` · ${esc(e.time)}` : ""}`;

  if (mode === "home") {
    return `<article class="${cls}" data-past="${past ? 1 : 0}">
  <a class="slide-media" href="${link}" tabindex="-1" aria-hidden="true">${media}</a>
  <h3><a href="${link}">${esc(e.title)}</a></h3>
  <p class="slide-meta">${meta}</p>
  <p>${esc(e.description)}</p>
</article>`;
  }

  const strava = safeUrl(e.strava);
  const r = !past && e.registration;
  return `<article class="${cls}" id="${esc(eventAnchor(e.id))}">
  <div class="slide-media">${media}</div>
  <p class="slide-meta">${meta}</p>
  <h3>${esc(e.title)}</h3>
  ${e.location ? `<p class="slide-loc">${esc(e.location)}</p>` : ""}
  ${e.level ? `<p class="slide-loc">${esc(e.level)}</p>` : ""}
  ${e.description ? `<p class="slide-desc">${esc(e.description)}</p>` : ""}
  ${
    r || strava || reel
      ? `<div class="slide-actions">
    ${
      r
        ? `<button type="button" class="btn-register" data-event-id="${esc(e.id)}" data-event-title="${esc(e.title)}"
        data-event-date="${esc(`${e.dateLabel} · ${e.time}`)}" data-event-price="${esc(formatEuro(r.price))}"
        data-closes-at="${esc(r.closesAt)}" disabled>Anmelden · ${esc(formatEuro(r.price))}</button>
      <p class="seats" data-seats-for="${esc(e.id)}">Plätze werden geladen …</p>`
        : ""
    }
    ${strava ? `<a class="btn-strava" href="${esc(strava)}" target="_blank" rel="noopener">${past ? "Aktivität auf Strava" : "Auf Strava ansehen"} ↗</a>` : ""}
    ${reel ? `<a class="btn-strava btn-reel" href="${esc(reel)}" target="_blank" rel="noopener">Reel auf Instagram ↗</a>` : ""}
  </div>`
      : ""
  }
</article>`;
}

/** Slider so scrollen, dass das erste kommende Event links steht (vergangene liegen links davon). */
export function scrollToFirstUpcoming(track: HTMLElement) {
  const slides = Array.from(track.querySelectorAll<HTMLElement>(".slide"));
  const target = slides.find((s) => s.dataset.past !== "1") ?? slides[slides.length - 1];
  if (!target) return;
  const pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
  // Bei nur wenigen kommenden Events reicht die Breite nicht, um das nächste Event
  // ganz links anzuzeigen → rechts Platz anhängen, damit Vergangenes verborgen bleibt.
  track.style.paddingRight = "";
  track.style.gridAutoColumns = "";
  // Spaltenbreite festhalten – sonst schrumpfen die Blöcke durch das zusätzliche Padding
  track.style.gridAutoColumns = `${target.offsetWidth}px`;
  const last = slides[slides.length - 1];
  const contentRight = last.offsetLeft + last.offsetWidth + pad;
  const missing = target.offsetLeft - pad + track.clientWidth - contentRight;
  if (missing > 0) track.style.paddingRight = `${pad + missing}px`;
  const prev = track.style.scrollSnapType;
  track.style.scrollSnapType = "none";
  track.scrollLeft = target.offsetLeft - pad;
  requestAnimationFrame(() => (track.style.scrollSnapType = prev));
}

/** Bei Größenänderung neu ausrichten */
export function keepAlignedOnResize(track: HTMLElement) {
  let t: ReturnType<typeof setTimeout>;
  let w = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === w) return; // mobile Adressleiste o. ä.
    w = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(() => scrollToFirstUpcoming(track), 150);
  });
}

/** Pfeil-Buttons eines Sliders verbinden */
export function wireSlider(slider: HTMLElement) {
  const track = slider.querySelector<HTMLElement>(".slider-track")!;
  slider.querySelectorAll<HTMLButtonElement>(".slider-nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slide = track.querySelector<HTMLElement>(".slide");
      const step = slide ? slide.offsetWidth + 18 : track.clientWidth * 0.8;
      track.scrollBy({ left: Number(btn.dataset.dir) * step, behavior: "smooth" });
    });
  });
}

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
};

/**
 * Nächster Rookie Ride: das nächste kommende Event, dessen Titel oder ID "Rookie" enthält.
 * → In der Event-Verwaltung einfach ein Event "Rookie Ride" anlegen, dann erscheint es automatisch.
 */
export function nextRookieRide(all: PublicEvent[], today = todayISO()): PublicEvent | null {
  return splitEvents(all, 0, today).upcoming.find((e) => /rookie/i.test(`${e.title} ${e.id}`)) ?? null;
}

/** Kurzer Termin-Text, z. B. "Mi, 12. November · 18:15 Uhr" */
export function rookieDateText(e: PublicEvent): string {
  const wd = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${e.dateISO}T12:00:00Z`),
  );
  return `${wd.replace(".,", ",")}${e.time ? ` · ${e.time}` : ""}`;
}

/** Rookie-Status aus der Verwaltung: true = ausgebucht, false = Plätze frei, null = unbekannt */
export async function fetchRookieFull(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/site-settings", { cache: "no-store" });
    if (!res.ok) return null;
    const s = await res.json();
    return typeof s.rookieFull === "boolean" ? s.rookieFull : null;
  } catch {
    return null;
  }
}

/** Status-Zeile ("Ausgebucht" / "Noch Plätze frei") unter dem Datum setzen */
export function showRookieStatus(el: HTMLElement | null, hasRide: boolean, full: boolean | null) {
  if (!el) return;
  el.hidden = !hasRide || full === null;
  el.classList.toggle("is-full", !!full);
  el.textContent = full ? "Ausgebucht" : "Noch Plätze frei";
}
