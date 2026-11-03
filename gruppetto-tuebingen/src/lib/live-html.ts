// Schreibt aktuelle Daten (Events aus der Verwaltung, Off-Season, Rookie-Status) direkt ins HTML,
// bevor die Seite beim Besucher ankommt – so blitzt nie der Stand vom letzten Build auf.
// Läuft in der Netlify Edge Function (netlify/edge-functions/live-content.ts).
// Reine String-Ersetzungen an festen Markierungen (data-…-Attribute); fehlt eine, bleibt das HTML wie es ist.
import { dialHTML, type SeatStatus } from "./event-dial.ts";
import { esc, nextRookieRide, rookieDateText, safeUrl, shortDate, splitEvents, type PublicEvent } from "./public-events.ts";

export interface LiveData {
  events: PublicEvent[] | null;
  settings: { offseason?: boolean; rookieFull?: boolean } | null;
  seats: SeatStatus | null;
}

const STRAVA = "https://www.strava.com/clubs/gruppetto-tuebingen";

/** Öffnendes Tag mit diesem Attribut finden und per Funktion umbauen */
function editTag(html: string, attr: string, fn: (tag: string) => string): string {
  const re = new RegExp(`<[a-z]+\\b[^>]*\\s${attr}(?=[\\s=>])[^>]*>`, "i");
  return html.replace(re, (tag) => fn(tag));
}

const setHidden = (tag: string, hidden: boolean) => {
  const clean = tag.replace(/\shidden(="[^"]*")?(?=[\s>])/, "");
  return hidden ? clean.replace(/>$/, " hidden>") : clean;
};

const toggleClass = (tag: string, cls: string, on: boolean) => {
  if (/\sclass="/.test(tag)) {
    return tag.replace(/\sclass="([^"]*)"/, (_m, c: string) => {
      const list = c.split(/\s+/).filter((x) => x && x !== cls);
      if (on) list.push(cls);
      return ` class="${list.join(" ")}"`;
    });
  }
  return on ? tag.replace(/^<([a-z]+)/i, `<$1 class="${cls}"`) : tag;
};

/** Text eines Elements (ohne Kind-Elemente) ersetzen */
function setText(html: string, attr: string, text: string): string {
  const re = new RegExp(`(<[a-z]+\\b[^>]*\\s${attr}(?=[\\s=>])[^>]*>)[^<]*(<\\/)`, "i");
  return html.replace(re, (_m, open: string, close: string) => open + esc(text) + close);
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  return re.test(tag) ? tag.replace(re, ` ${name}="${esc(value)}"`) : tag.replace(/>$/, ` ${name}="${esc(value)}">`);
}

function rookieStatus(html: string, hasRide: boolean, full: boolean | null): string {
  html = editTag(html, "data-rookie-status", (t) => toggleClass(setHidden(t, !hasRide || full === null), "is-full", !!full));
  return setText(html, "data-rookie-status", full ? "Ausgebucht" : "Noch Plätze frei");
}

export function applyLive(path: string, html: string, d: LiveData): string {
  const p = path.replace(/\/+$/, "") || "/";
  const full = typeof d.settings?.rookieFull === "boolean" ? d.settings.rookieFull : null;

  // Off-Season: Info-Leiste auf allen Seiten
  if (d.settings) {
    html = html.replace(/<html\b[^>]*>/i, (t) => toggleClass(t, "offseason", !!d.settings!.offseason));
  }

  if (p === "/" && d.events) {
    const next = splitEvents(d.events, 0).upcoming[0];
    html = editTag(html, "data-next-event", (t) => setHidden(t, !next));
    if (next) {
      html = setText(html, "data-next-title", next.title);
      html = setText(html, "data-next-date", shortDate(next.dateISO));
    }
    const r = nextRookieRide(d.events);
    html = editTag(html, "data-rookie-next", (t) => setHidden(t, !r));
    if (r) {
      html = setText(html, "data-rookie-date", shortDate(r.dateISO));
      html = setText(html, "data-rookie-time", r.time ? ` · ${r.time}` : "");
    }
    html = rookieStatus(html, !!r, full);
    // Events-Rad komplett neu (bis zur Endmarke) – mit Teilnehmerzahlen
    html = html.replace(/(<div\b[^>]*\sid="home-dial"[^>]*>)[\s\S]*?<i hidden data-dial-end><\/i>/, (_m, open: string) =>
      open.replace(/>$/, " data-live>") + dialHTML(d.events!, d.seats ?? {}),
    );
  }

  if (p === "/rookies" && d.events) {
    const r = nextRookieRide(d.events);
    html = setText(html, "data-rookie-date", r ? rookieDateText(r) : "Termin folgt");
    html = setText(html, "data-rookie-loc", r ? r.location || "Treffpunkt: Finanzamt Tübingen" : "Den nächsten Termin geben wir im Strava Club bekannt.");
    html = editTag(html, "data-rookie-link", (t) => setAttr(t, "href", (r && safeUrl(r.strava)) || STRAVA));
    html = setText(html, "data-rookie-link", full && r ? "Auf Strava ansehen ↗" : "Auf Strava zusagen ↗");
    html = rookieStatus(html, !!r, full);
  }

  if (p === "/rides" && d.settings?.offseason) {
    html = editTag(html, 'id="rides-block"', (t) => toggleClass(t, "is-offseason", true));
    html = html.replace(/<section\b[^>]*class="rides-list"[^>]*>/, (t) => t.replace(/>$/, ' inert aria-hidden="true">'));
    html = editTag(html, 'id="offseason"', (t) => setHidden(t, false));
  }

  return html;
}
