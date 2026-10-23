// Verwaltung → Reiter „Events“: Dashboard mit allen Events (heute, kommend, vergangen).
// Events anlegen, bearbeiten, löschen – inkl. Strava-Link, Instagram-Reel-Link und
// Reel-Video (spielt beim Hovern stumm ab). Alles wird dauerhaft gespeichert.
// Dazu die Anmeldung: Preis, max. Teilnehmer, Anmeldeschluss, Pause – und die aktuelle Belegung.
import { events as codeEvents, germanDateLabel, type GruppettoEvent, type Registration } from "../../src/data/events";
import {
  type EventOverride,
  type StoredEvent,
  VIDEO_CHUNK,
  VIDEO_MAX,
  VIDEO_TYPES,
  deleteStoredEvent,
  deleteVideo,
  imageStore,
  imageUrl,
  readOverrides,
  readStoredEvents,
  saveOverride,
  saveStoredEvent,
  validateRegistration,
  videoStore,
  videoUrl,
} from "./event-store";
import { type LedgerStore, isActive, readLedger, seatsTaken, updateJSON } from "./registrations";
import { escapeHtml as h, json } from "./services";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const REEL_RE = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_-]+\/?(\?[^\s]*)?$/i;

const todayISO = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()); // YYYY-MM-DD

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export const ADMIN_EVENTS_CSS = `
.tabs{display:flex;gap:.4rem;margin:0 0 1.6rem;border-bottom:1px solid var(--line)}
.tabs a{padding:.6rem 1rem;text-decoration:none;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-1px}
.tabs a[aria-current=page]{color:var(--text);border-bottom-color:var(--blue)}
.tabs a:hover{color:var(--text)}
.btn.danger{background:#3a2420;color:var(--warn)}
.btn.small{padding:.4rem .8rem;font-size:.82rem}
/* Kennzahlen */
.ev-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:.8rem;margin:0 0 1.2rem}
.ev-stats .card b{font-size:1.8rem}
/* Werkzeugleiste */
.ev-toolbar{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:0 0 1.2rem}
.ev-toolbar .chips{display:flex;gap:.3rem;background:var(--alt);border-radius:99px;padding:.25rem}
.ev-toolbar .chips button{border:0;background:transparent;color:var(--muted);font:600 .85rem Inter,system-ui,sans-serif;padding:.45rem .9rem;border-radius:99px;cursor:pointer}
.ev-toolbar .chips button[aria-pressed=true]{background:var(--blue);color:var(--text)}
.ev-toolbar input[type=search]{flex:1;min-width:180px;padding:.55rem .9rem;border-radius:99px;border:1px solid var(--line);background:var(--alt);color:var(--text);font:inherit}
/* Formular */
details.ev-editor{background:var(--alt);border-radius:14px;margin:0 0 1.6rem}
details.ev-editor>summary{cursor:pointer;padding:1rem 1.2rem;font-weight:700;list-style:none}
details.ev-editor>summary::-webkit-details-marker{display:none}
details.ev-editor>summary::before{content:"+ ";color:var(--muted)}
details.ev-editor[open]>summary::before{content:"– "}
.ev-form{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:0 1.2rem 1.2rem}
.ev-form label{display:grid;gap:.35rem;font-size:.9rem;color:var(--muted)}
.ev-form .full{grid-column:1/-1}
.ev-form input,.ev-form textarea{width:100%;padding:.65rem .8rem;border:1px solid var(--line);background:var(--bg);color:var(--text);font:inherit;border-radius:8px}
.ev-form input[readonly]{opacity:.6}
.ev-form textarea{min-height:7rem;resize:vertical}
.ev-form input:focus,.ev-form textarea:focus{outline:2px solid var(--text);outline-offset:1px}
.ev-form .row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.ev-form .check{display:flex;gap:.5rem;align-items:center;color:var(--text)}
.ev-form .check input{width:auto}
.ev-form fieldset{grid-column:1/-1;border:1px solid var(--line);border-radius:12px;padding:1rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:0}
.ev-form legend{padding:0 .4rem;color:var(--text);font-weight:600}
.ev-preview{max-width:220px;max-height:220px;border-radius:8px;display:block;margin-top:.4rem;background:var(--bg)}
.ev-progress{height:6px;border-radius:99px;background:var(--bg);overflow:hidden;display:none}
.ev-progress.on{display:block}.ev-progress i{display:block;height:100%;width:0;background:var(--text);transition:width .2s}
/* Event-Karten */
.ev-section h2{display:flex;align-items:baseline;gap:.6rem}.ev-section h2 small{color:var(--muted);font-weight:500}
.ev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}
.ev-card{position:relative;background:var(--alt);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:transform .35s cubic-bezier(.2,.7,.2,1),box-shadow .35s}
.ev-card.has-video:hover,.ev-card.has-video:focus-within{transform:scale(1.07);z-index:3;box-shadow:0 22px 50px rgba(0,0,0,.45)}
.ev-media{position:relative;aspect-ratio:4/5;background:linear-gradient(135deg,var(--line),var(--blue))}
.ev-media img,.ev-media video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ev-media video{opacity:0;transition:opacity .3s}
.ev-card.playing .ev-media video{opacity:1}.ev-card.playing .play{opacity:0}
.ev-media .play{position:absolute;right:.6rem;bottom:.6rem;background:rgba(13,30,64,.75);border-radius:99px;padding:.2rem .6rem;font-size:.75rem}
.ev-body{padding:.9rem 1rem 1rem;display:flex;flex-direction:column;gap:.35rem;flex:1}
.ev-body h3{margin:0;font-size:1.05rem;line-height:1.3}
.ev-date{margin:0;color:var(--muted);font-size:.85rem}
.ev-badges{display:flex;flex-wrap:wrap;gap:.3rem}
.ev-badges .tag{font-size:.72rem}
.ev-actions{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:auto;padding-top:.5rem}
.ev-actions form{display:inline}
.ev-card[data-status=vergangen] .ev-media img{filter:saturate(.75)}
.ev-empty{color:var(--muted)}
/* Belegung */
.ev-seats{display:grid;gap:.3rem;margin:.2rem 0 .1rem;font-size:.85rem}
.ev-seats .bar{height:6px;border-radius:99px;background:var(--bg);overflow:hidden}
.ev-seats .bar i{display:block;height:100%;background:var(--blue)}
.ev-seats.full .bar i{background:var(--warn)}
.ev-seats .line{display:flex;justify-content:space-between;gap:.5rem}
.ev-reg-info{grid-column:1/-1;margin:0;padding:.7rem .9rem;border-radius:10px;background:var(--bg);color:var(--text);font-size:.9rem}
.ev-form fieldset[disabled] label{opacity:.45}
@media (max-width:800px){.ev-stats{grid-template-columns:repeat(2,1fr)}.ev-form,.ev-form fieldset{grid-template-columns:1fr}}
`;

export function tabNav(active: "zahlungen" | "events" | "rookies") {
  return `<nav class="tabs" aria-label="Bereiche">
  <a href="?" ${active === "zahlungen" ? 'aria-current="page"' : ""}>Anmeldungen &amp; Zahlungen</a>
  <a href="?tab=events" ${active === "events" ? 'aria-current="page"' : ""}>Events</a>
  <a href="?tab=rookies" ${active === "rookies" ? 'aria-current="page"' : ""}>Rookies</a>
</nav>`;
}

// ---------------------------------------------------------------------------
// Ansicht

/** Ein Event so, wie das Dashboard es braucht (Code-Events inkl. Änderungen) */
interface AdminRow {
  id: string;
  source: "code" | "admin";
  title: string;
  dateISO: string;
  time: string; // "HH:MM" (admin) oder "17:30 Uhr" (code)
  location: string;
  description: string;
  image: string;
  imageId?: string;
  strava?: string;
  reelUrl?: string;
  reelVideoId?: string;
  /** Aktuelle Anmelde-Einstellungen (undefined = keine Anmeldung) */
  registration?: Registration;
  /** Belegung laut Teilnehmerliste */
  booking: Booking;
  edited: boolean;
}

interface Booking {
  /** bezahlt und nicht erstattet */
  active: number;
  /** gerade in Bezahlung (Platz 30 Min. reserviert) */
  pending: number;
  /** gibt es schon irgendeine Anmeldung (auch erstattete)? */
  hasAny: boolean;
}
const NO_BOOKING: Booking = { active: 0, pending: 0, hasAny: false };

async function bookingOf(store: LedgerStore, id: string, first?: number): Promise<Booking> {
  const l = await readLedger(store, id, first);
  const active = l.paid.filter(isActive).length;
  return { active, pending: seatsTaken(l) - active, hasAny: l.paid.length > 0 || Object.keys(l.pending).length > 0 };
}

function codeRow(e: GruppettoEvent, ov?: EventOverride): AdminRow {
  return {
    id: e.id,
    source: "code",
    title: ov?.title || e.title,
    dateISO: ov?.dateISO || e.dateISO,
    time: ov?.time !== undefined ? ov.time : e.time,
    location: ov?.location ?? e.location.replace(/^Treffpunkt:\s*/i, ""),
    description: ov?.description ?? e.description,
    image: ov?.imageId ? imageUrl(ov.imageId) : e.image,
    imageId: ov?.imageId,
    strava: ov?.strava !== undefined ? ov.strava || undefined : e.strava,
    reelUrl: ov?.reelUrl,
    reelVideoId: ov?.reelVideoId,
    registration: ov?.registration === null ? undefined : (ov?.registration ?? e.registration),
    booking: NO_BOOKING,
    edited: !!ov,
  };
}

function adminRow(e: StoredEvent): AdminRow {
  return {
    id: e.id,
    source: "admin",
    title: e.title,
    dateISO: e.dateISO,
    time: e.time,
    location: e.location ?? "",
    description: e.description,
    image: e.imageId ? imageUrl(e.imageId) : "",
    imageId: e.imageId,
    strava: e.strava,
    reelUrl: e.reelUrl,
    reelVideoId: e.reelVideoId,
    registration: e.registration,
    booking: NO_BOOKING,
    edited: false,
  };
}

async function loadRows(store: LedgerStore): Promise<AdminRow[]> {
  const [stored, overrides] = await Promise.all([readStoredEvents(store), readOverrides(store)]);
  const rows = [...codeEvents.map((e) => codeRow(e, overrides[e.id])), ...stored.map(adminRow)];
  await Promise.all(
    rows.filter((r) => r.registration).map(async (r) => (r.booking = await bookingOf(store, r.id, r.registration!.firstStartNumber))),
  );
  return rows;
}

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** Belegung als Balken + Text */
function seatsHTML(r: AdminRow) {
  const reg = r.registration!;
  const taken = r.booking.active + r.booking.pending;
  const full = taken >= reg.capacity;
  const pct = Math.min(100, Math.round((taken / reg.capacity) * 100));
  return `<div class="ev-seats${full ? " full" : ""}">
    <div class="line"><span><b>${r.booking.active}</b> / ${reg.capacity} Plätze belegt${r.booking.pending ? ` <span class="muted">(+${r.booking.pending} in Bezahlung)</span>` : ""}</span><span>${euro(reg.price)}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
  </div>`;
}

function card(r: AdminRow, status: "heute" | "kommend" | "vergangen") {
  const timeLabel = r.source === "admin" ? (r.time ? `${r.time} Uhr` : "") : r.time;
  const badges = [
    `<span class="tag wait">${r.source === "code" ? (r.edited ? "Code · bearbeitet" : "Code") : "Verwaltung"}</span>`,
    r.registration
      ? r.registration.paused
        ? '<span class="tag wait">Anmeldung pausiert</span>'
        : r.booking.active + r.booking.pending >= r.registration.capacity
          ? '<span class="tag ref">Ausgebucht</span>'
          : '<span class="tag">Anmeldung offen</span>'
      : "",
    r.strava ? '<span class="tag">Strava</span>' : "",
    r.reelUrl ? '<span class="tag">Reel-Link</span>' : "",
    r.reelVideoId ? '<span class="tag">Reel-Video</span>' : "",
  ].join("");
  return `<article class="ev-card${r.reelVideoId ? " has-video" : ""}" data-status="${status}" data-search="${h(`${r.title} ${r.location} ${r.dateISO}`.toLowerCase())}">
  <div class="ev-media">
    ${r.image ? `<img src="${h(r.image)}" alt="" loading="lazy">` : ""}
    ${r.reelVideoId ? `<video muted loop playsinline preload="none" src="${h(videoUrl(r.reelVideoId))}"></video><span class="play">▶ Reel</span>` : ""}
  </div>
  <div class="ev-body">
    <p class="ev-date">${h(germanDateLabel(r.dateISO))}${timeLabel ? ` · ${h(timeLabel)}` : ""}</p>
    <h3>${h(r.title)}</h3>
    <div class="ev-badges">${badges}</div>
    ${r.registration ? seatsHTML(r) : ""}
    <div class="ev-actions">
      <a class="btn small" href="?tab=events&edit=${encodeURIComponent(r.id)}#editor">Bearbeiten</a>
      ${r.registration || r.booking.hasAny ? `<a class="btn small sec" href="?event=${encodeURIComponent(r.id)}">Teilnehmer</a>` : ""}
      ${r.reelUrl ? `<a class="btn small sec" href="${h(r.reelUrl)}" target="_blank" rel="noopener">Reel ↗</a>` : ""}
      ${
        r.source === "admin" && !r.booking.hasAny
          ? `<form method="post" action="?tab=events&action=event-delete" onsubmit="return confirm('Event wirklich löschen? Bild und Video werden mit gelöscht.')">
          <input type="hidden" name="id" value="${h(r.id)}"><button class="btn small danger">Löschen</button></form>`
          : r.edited
            ? `<form method="post" action="?tab=events&action=event-reset" onsubmit="return confirm('Alle Änderungen an diesem Event zurücksetzen?')">
          <input type="hidden" name="id" value="${h(r.id)}"><button class="btn small sec">Zurücksetzen</button></form>`
            : ""
      }
    </div>
  </div>
</article>`;
}

function editorForm(e?: AdminRow) {
  const isCode = e?.source === "code";
  const timeValue = e ? (isCode ? e.time : e.time) : "";
  return `<details class="ev-editor" id="editor" ${e ? "open" : ""}>
<summary>${e ? `Event bearbeiten: ${h(e.title)}` : "Neues Event anlegen"}</summary>
<form class="ev-form" method="post" action="?tab=events&action=event-save" enctype="multipart/form-data" id="ev-form">
  ${e ? `<input type="hidden" name="id" value="${h(e.id)}"><input type="hidden" name="source" value="${e.source}">` : ""}
  <input type="hidden" name="newVideoId" id="ev-new-video">
  <label class="full">Titel *<input name="title" required maxlength="120" value="${h(e?.title ?? "")}"></label>
  <label>Datum *<input type="date" name="date" required value="${h(e?.dateISO ?? "")}"></label>
  ${
    isCode
      ? `<label>Uhrzeit <span class="muted">(Text, z. B. „18:15 Uhr“ oder „11:00–18:00 Uhr“)</span><input name="timeText" maxlength="40" value="${h(timeValue)}"></label>`
      : `<label>Uhrzeit<input type="time" name="time" value="${h(timeValue)}"></label>`
  }
  <label class="full">Treffpunkt <span class="muted">(optional)</span><input name="location" maxlength="120" value="${h(e?.location ?? "")}" placeholder="z. B. Finanzamt Tübingen"></label>
  <label class="full">Beschreibung<textarea name="description" maxlength="2000">${h(e?.description ?? "")}</textarea></label>

  ${registrationFieldset(e)}

  <fieldset>
    <legend>Links</legend>
    <label>Strava-Link<input type="url" name="strava" maxlength="300" value="${h(e?.strava ?? "")}" placeholder="https://www.strava.com/…"></label>
    <label>Instagram-Reel-Link<input type="url" name="reelUrl" maxlength="300" value="${h(e?.reelUrl ?? "")}" placeholder="https://www.instagram.com/reel/…"></label>
  </fieldset>

  <fieldset>
    <legend>Bild &amp; Reel-Video</legend>
    <label>Bild <span class="muted">(JPG/PNG/WebP – wird automatisch verkleinert)</span>
      <input type="file" name="image" accept="image/jpeg,image/png,image/webp" id="ev-image">
      ${e?.image ? `<img class="ev-preview" src="${h(e.image)}" alt="Aktuelles Bild" id="ev-preview">` : '<img class="ev-preview" id="ev-preview" alt="" hidden>'}
      ${e?.imageId ? '<span class="check"><input type="checkbox" name="removeImage" value="1"> Bild entfernen</span>' : ""}
    </label>
    <label>Reel-Video <span class="muted">(MP4/MOV, max. 150 MB – spielt auf der Website beim Hovern stumm ab)</span>
      <input type="file" accept="video/mp4,video/quicktime,video/webm" id="ev-video">
      ${e?.reelVideoId ? `<video class="ev-preview" src="${h(videoUrl(e.reelVideoId))}" muted loop playsinline controls preload="metadata"></video>
        <span class="check"><input type="checkbox" name="removeVideo" value="1"> Video entfernen</span>` : ""}
      <div class="ev-progress" id="ev-progress"><i></i></div>
    </label>
  </fieldset>

  <div class="row full">
    <button class="btn" id="ev-submit">${e ? "Änderungen speichern" : "Event anlegen"}</button>
    ${e ? '<a class="btn sec" href="?tab=events">Abbrechen</a>' : ""}
    <span class="muted" id="ev-status" role="status"></span>
  </div>
</form>
</details>`;
}

function registrationFieldset(e?: AdminRow) {
  const reg = e?.registration;
  const b = e?.booking ?? NO_BOOKING;
  const closes = reg?.closesAt ?? "";
  return `<fieldset id="ev-reg">
    <legend>Anmeldung &amp; Bezahlung</legend>
    <label class="check full"><input type="checkbox" name="regEnabled" value="1" id="ev-reg-on" ${reg ? "checked" : ""}> Anmeldung mit Bezahlung anbieten <span class="muted">(Button „Anmelden“ auf der Events-Seite, Bezahlung über Stripe, Startnummer per Mail)</span></label>
    ${
      e && reg
        ? `<p class="ev-reg-info">Aktuell: <b>${b.active}</b> von ${reg.capacity} Plätzen belegt${b.pending ? ` · ${b.pending} gerade in Bezahlung` : ""} · <a href="?event=${encodeURIComponent(e.id)}">Teilnehmerliste ansehen</a></p>`
        : ""
    }
    <label>Preis pro Person (€) *<input type="number" name="regPrice" min="0.5" max="1000" step="0.01" inputmode="decimal" value="${reg ? h(String(reg.price)) : ""}" placeholder="z. B. 15"></label>
    <label>Max. Teilnehmer *<input type="number" name="regCapacity" min="${Math.max(1, b.active + b.pending)}" max="5000" step="1" inputmode="numeric" value="${reg ? h(String(reg.capacity)) : ""}" placeholder="z. B. 20"></label>
    <label>Anmeldeschluss <span class="muted">(leer = Event-Tag, 0:00 Uhr)</span><input type="datetime-local" name="regClosesAt" value="${h(closes)}"></label>
    <label>Erste Startnummer <span class="muted">(Standard 1${b.hasAny ? " – nach der ersten Anmeldung nicht mehr änderbar" : ""})</span><input type="number" name="regFirst" min="1" step="1" value="${reg?.firstStartNumber ? h(String(reg.firstStartNumber)) : ""}" placeholder="1" ${b.hasAny ? "readonly" : ""}></label>
    <label class="check full"><input type="checkbox" name="regPaused" value="1" ${reg?.paused ? "checked" : ""}> Anmeldung pausieren <span class="muted">(keine neuen Anmeldungen, bestehende bleiben gültig)</span></label>
    <p class="full muted" style="margin:0">Preisänderungen gelten für neue Anmeldungen – wer schon bezahlt hat, behält seinen Betrag. Die Teilnehmerzahl kann nicht unter die Zahl der bereits belegten Plätze gesenkt werden.${b.hasAny ? " Weil es schon Anmeldungen gibt, lässt sich die Anmeldung nur noch pausieren, nicht mehr ganz entfernen." : ""}</p>
  </fieldset>`;
}

const SCRIPT = `<script>
(() => {
  // Anmelde-Felder nur aktiv, wenn „Anmeldung anbieten“ angehakt ist
  const regOn = document.getElementById("ev-reg-on");
  if (regOn) {
    const sync = () => document.querySelectorAll("#ev-reg input:not(#ev-reg-on)").forEach((i) => {
      i.disabled = !regOn.checked;
      if (i.name === "regPrice" || i.name === "regCapacity") i.required = regOn.checked;
    });
    regOn.addEventListener("change", sync); sync();
  }
  const form = document.getElementById("ev-form");
  const img = document.getElementById("ev-image");
  const preview = document.getElementById("ev-preview");
  const vid = document.getElementById("ev-video");
  const btn = document.getElementById("ev-submit");
  const status = document.getElementById("ev-status");
  const bar = document.getElementById("ev-progress");
  const label = btn.textContent;

  // Bild im Browser auf max. 1600 px verkleinern
  img.addEventListener("change", async () => {
    const file = img.files && img.files[0];
    if (!file) return;
    btn.disabled = true; status.textContent = "Bild wird vorbereitet …";
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "event.jpg", { type: "image/jpeg" }));
      img.files = dt.files;
      preview.src = URL.createObjectURL(blob); preview.hidden = false;
    } catch (e) { /* dann wird das Original hochgeladen */ }
    btn.disabled = false; status.textContent = "";
  });

  // Reel-Video stückweise hochladen, danach das Formular normal absenden
  form.addEventListener("submit", async (ev) => {
    const file = vid.files && vid.files[0];
    if (!file || form.dataset.videoDone) return;
    ev.preventDefault();
    if (!form.reportValidity()) return;
    btn.disabled = true; bar.classList.add("on");
    const post = async (q, body, type) => {
      const r = await fetch("?tab=events&action=" + q, { method: "POST", body, headers: type ? { "content-type": type } : {} });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Upload fehlgeschlagen (" + r.status + ")");
      return j;
    };
    try {
      const init = await post("video-init", JSON.stringify({ size: file.size, type: file.type || "video/mp4" }), "application/json");
      const total = Math.ceil(file.size / init.chunkSize);
      for (let n = 0; n < total; n++) {
        status.textContent = "Video wird hochgeladen … " + Math.round((n / total) * 100) + " %";
        bar.firstElementChild.style.width = (n / total) * 100 + "%";
        const part = file.slice(n * init.chunkSize, (n + 1) * init.chunkSize);
        let tries = 0;
        for (;;) {
          try { await post("video-chunk&id=" + init.id + "&n=" + n, part, "application/octet-stream"); break; }
          catch (e) { if (++tries >= 3) throw e; await new Promise((r) => setTimeout(r, 800 * tries)); }
        }
      }
      await post("video-done&id=" + init.id, "", "text/plain");
      bar.firstElementChild.style.width = "100%";
      status.textContent = "Video hochgeladen – speichere …";
      document.getElementById("ev-new-video").value = init.id;
      form.dataset.videoDone = "1";
      form.submit();
    } catch (e) {
      status.textContent = e.message;
      btn.disabled = false; btn.textContent = label; bar.classList.remove("on");
    }
  });

  // Filter & Suche
  const chips = document.querySelectorAll(".ev-toolbar .chips button");
  const search = document.getElementById("ev-search");
  const apply = () => {
    const f = document.querySelector(".ev-toolbar .chips [aria-pressed=true]").dataset.filter;
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll(".ev-section").forEach((sec) => {
      let shown = 0;
      sec.querySelectorAll(".ev-card").forEach((c) => {
        const ok = (f === "alle" || c.dataset.status === f || (f === "kommend" && c.dataset.status === "heute")) && (!q || c.dataset.search.includes(q));
        c.hidden = !ok; if (ok) shown++;
      });
      sec.hidden = shown === 0;
    });
  };
  chips.forEach((b) => b.addEventListener("click", () => { chips.forEach((x) => x.setAttribute("aria-pressed", x === b)); apply(); }));
  search.addEventListener("input", apply);

  // Reel-Vorschau: beim Hovern größer + stumm abspielen
  document.querySelectorAll(".ev-card.has-video").forEach((c) => {
    const v = c.querySelector("video");
    const on = () => { c.classList.add("playing"); v.play().catch(() => {}); };
    const off = () => { c.classList.remove("playing"); v.pause(); };
    c.addEventListener("mouseenter", on); c.addEventListener("mouseleave", off);
    c.addEventListener("focusin", on); c.addEventListener("focusout", off);
  });
})();
</script>`;

export async function eventsAdminBody(store: LedgerStore, opts: { editId?: string; flash?: string; error?: string } = {}) {
  const rows = await loadRows(store);
  const today = todayISO();
  const editing = opts.editId ? rows.find((r) => r.id === opts.editId) : undefined;

  const heute = rows.filter((r) => r.dateISO === today);
  const kommend = rows.filter((r) => r.dateISO > today).sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  const vergangen = rows.filter((r) => r.dateISO < today).sort((a, b) => (b.dateISO + b.time).localeCompare(a.dateISO + a.time));
  const withReel = rows.filter((r) => r.reelUrl || r.reelVideoId).length;
  const upcomingBooked = [...heute, ...kommend].reduce((n, r) => n + (r.registration ? r.booking.active : 0), 0);

  const section = (title: string, list: AdminRow[], status: "heute" | "kommend" | "vergangen", hint = "") =>
    list.length
      ? `<section class="ev-section"><h2>${title} <small>${list.length}${hint}</small></h2><div class="ev-grid">${list.map((r) => card(r, status)).join("")}</div></section>`
      : "";

  return `${opts.flash ? `<div class="note">${h(opts.flash)}</div>` : ""}
${opts.error ? `<div class="note warn">${h(opts.error)}</div>` : ""}
<div class="ev-stats">
  <div class="card"><span class="muted">Heute</span><b>${heute.length}</b></div>
  <div class="card"><span class="muted">Kommend</span><b>${kommend.length}</b></div>
  <div class="card"><span class="muted">Vergangen</span><b>${vergangen.length}</b></div>
  <div class="card"><span class="muted">Mit Reel</span><b>${withReel}</b></div>
  <div class="card"><span class="muted">Angemeldet (kommend)</span><b>${upcomingBooked}</b></div>
</div>
${editorForm(editing)}
<div class="ev-toolbar">
  <div class="chips" role="group" aria-label="Filter">
    <button type="button" data-filter="alle" aria-pressed="true">Alle</button>
    <button type="button" data-filter="kommend" aria-pressed="false">Kommend</button>
    <button type="button" data-filter="vergangen" aria-pressed="false">Vergangen</button>
  </div>
  <input type="search" id="ev-search" placeholder="Event suchen …" aria-label="Event suchen">
</div>
${section("Heute", heute, "heute")}
${section("Kommend", kommend, "kommend")}
${section("Vergangen", vergangen, "vergangen", " · Startseite zeigt die letzten 4, Events-Seite alle")}
${rows.length ? "" : '<p class="ev-empty">Noch keine Events.</p>'}
${SCRIPT}`;
}

// ---------------------------------------------------------------------------
// Speichern / Löschen

type Result = { flash?: string; error?: string; editId?: string };

async function takeImage(form: FormData, ownerId: string, current?: string): Promise<{ imageId?: string; error?: string }> {
  const images = imageStore();
  const file = form.get("image");
  if (file && typeof file === "object" && (file as File).size > 0) {
    const f = file as File;
    const ext = IMAGE_TYPES[f.type];
    if (!ext) return { error: "Bitte ein Bild als JPG, PNG oder WebP hochladen." };
    if (f.size > MAX_IMAGE_BYTES) return { error: "Das Bild ist zu groß (max. 8 MB)." };
    const nextId = `ev-${ownerId.replace(/[^a-z0-9-]/g, "")}-${Date.now()}.${ext}`;
    await images.put(nextId, await f.arrayBuffer(), f.type);
    if (current) await images.remove(current).catch(() => {});
    return { imageId: nextId };
  }
  if (form.get("removeImage") && current) {
    await images.remove(current).catch(() => {});
    return { imageId: undefined };
  }
  return { imageId: current };
}

async function takeVideo(form: FormData, current?: string): Promise<{ reelVideoId?: string; error?: string }> {
  const fresh = String(form.get("newVideoId") ?? "");
  if (fresh) {
    if (!/^rv-[a-z0-9-]+$/.test(fresh)) return { error: "Ungültiges Video." };
    const meta = await videoStore().getMeta(fresh);
    if (!meta?.complete) return { error: "Das Video wurde nicht vollständig hochgeladen. Bitte erneut versuchen." };
    if (current) await deleteVideo(current);
    return { reelVideoId: fresh };
  }
  if (form.get("removeVideo") && current) {
    await deleteVideo(current);
    return { reelVideoId: undefined };
  }
  return { reelVideoId: current };
}

/** Anmelde-Felder aus dem Formular lesen und gegen die aktuelle Belegung prüfen */
function readRegistration(
  form: FormData,
  current: Registration | undefined,
  booking: Booking,
): { reg?: Registration; error?: string } {
  const str = (k: string) => String(form.get(k) ?? "").trim();
  if (!form.get("regEnabled")) {
    if (booking.hasAny && current)
      return { error: "Für dieses Event gibt es schon Anmeldungen – die Anmeldung kann nicht entfernt, nur pausiert werden." };
    return { reg: undefined };
  }
  const price = Number(str("regPrice").replace(",", "."));
  const capacity = Number(str("regCapacity"));
  const closesAt = str("regClosesAt").slice(0, 16) || undefined;
  const firstRaw = str("regFirst");
  // Startnummern-Beginn nach der ersten Anmeldung festhalten
  const firstStartNumber = booking.hasAny ? current?.firstStartNumber : firstRaw ? Number(firstRaw) : undefined;
  const reg: Registration = {
    price: Math.round(price * 100) / 100,
    capacity,
    ...(closesAt && { closesAt }),
    ...(firstStartNumber !== undefined && firstStartNumber !== 1 && { firstStartNumber }),
    ...(form.get("regPaused") && { paused: true }),
  };
  if (!str("regPrice") || !str("regCapacity")) return { error: "Bitte Preis und maximale Teilnehmerzahl angeben." };
  const err = validateRegistration(reg);
  if (err) return { error: err };
  const taken = booking.active + booking.pending;
  if (reg.capacity < taken)
    return { error: `Es sind schon ${taken} Plätze belegt – die maximale Teilnehmerzahl muss mindestens ${taken} sein.` };
  return { reg };
}

const sameRegistration = (a?: Registration, b?: Registration) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ? { price: b.price, capacity: b.capacity, ...(b.closesAt && { closesAt: b.closesAt }), ...(b.firstStartNumber !== undefined && b.firstStartNumber !== 1 && { firstStartNumber: b.firstStartNumber }), ...(b.paused && { paused: true }) } : null);

/** POST ?action=event-save */
export async function handleEventSave(store: LedgerStore, form: FormData): Promise<Result> {
  const str = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);
  const id = str("id", 80);
  const source = str("source", 10) === "code" ? "code" : "admin";
  const title = str("title", 120);
  const location = str("location", 120);
  const description = str("description", 2000);
  const strava = str("strava", 300);
  const reelUrl = str("reelUrl", 300);
  const back = { editId: id || undefined };

  if (title.length < 2) return { error: "Bitte einen Titel angeben.", ...back };
  if (strava && !/^https:\/\/[^\s]+$/i.test(strava)) return { error: "Der Strava-Link muss mit https:// beginnen.", ...back };
  if (reelUrl && !REEL_RE.test(reelUrl))
    return { error: "Bitte einen Instagram-Link wie https://www.instagram.com/reel/… angeben.", ...back };

  // ---- Event aus dem Code: Änderungen separat speichern
  if (source === "code") {
    const base = codeEvents.find((e) => e.id === id);
    if (!base) return { error: "Dieses Event gibt es nicht mehr." };
    const old = (await readOverrides(store))[id];
    const dateISO = str("date", 10);
    const timeText = str("timeText", 40);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: "Bitte ein gültiges Datum angeben.", ...back };
    const currentReg = old?.registration === null ? undefined : (old?.registration ?? base.registration);
    const booking = currentReg ? await bookingOf(store, id, currentReg.firstStartNumber) : await bookingOf(store, id, base.registration?.firstStartNumber);
    const regRes = readRegistration(form, currentReg, booking);
    if (regRes.error) return { error: regRes.error, ...back };
    const img = await takeImage(form, id, old?.imageId);
    if (img.error) return { error: img.error, ...back };
    const vid = await takeVideo(form, old?.reelVideoId);
    if (vid.error) return { error: vid.error, ...back };
    await saveOverride(store, id, {
      title: title !== base.title ? title : undefined,
      description: description !== base.description ? description : undefined,
      location: location !== base.location.replace(/^Treffpunkt:\s*/i, "") ? location : undefined,
      imageId: img.imageId,
      strava: strava !== (base.strava ?? "") ? strava : undefined,
      reelUrl: reelUrl || undefined,
      reelVideoId: vid.reelVideoId,
      dateISO: dateISO !== base.dateISO ? dateISO : undefined,
      time: timeText !== base.time ? timeText : undefined,
      registration: sameRegistration(regRes.reg, base.registration) ? undefined : (regRes.reg ?? null),
      updatedAt: new Date().toISOString(),
    });
    return { flash: `„${title}“ gespeichert.` };
  }

  // ---- Event aus der Verwaltung
  const dateISO = str("date", 10);
  const time = str("time", 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: "Bitte ein gültiges Datum angeben.", ...back };
  if (time && !/^\d{2}:\d{2}$/.test(time)) return { error: "Bitte eine gültige Uhrzeit angeben.", ...back };

  const stored = await readStoredEvents(store);
  const existing = id ? stored.find((e) => e.id === id) : undefined;
  if (id && !existing) return { error: "Dieses Event gibt es nicht mehr." };

  const booking = existing ? await bookingOf(store, existing.id, existing.registration?.firstStartNumber) : NO_BOOKING;
  const regRes = readRegistration(form, existing?.registration, booking);
  if (regRes.error) return { error: regRes.error, ...back };

  let newId = existing?.id;
  if (!newId) {
    const base = `${dateISO}-${slug(title) || "event"}`;
    const taken = new Set([...codeEvents.map((e) => e.id), ...stored.map((e) => e.id)]);
    newId = base;
    for (let n = 2; taken.has(newId); n++) newId = `${base}-${n}`;
  }

  const img = await takeImage(form, newId, existing?.imageId);
  if (img.error) return { error: img.error, ...back };
  const vid = await takeVideo(form, existing?.reelVideoId);
  if (vid.error) return { error: vid.error, ...back };

  const now = new Date().toISOString();
  await saveStoredEvent(store, {
    id: newId,
    title,
    dateISO,
    time,
    location: location || undefined,
    description,
    imageId: img.imageId,
    strava: strava || undefined,
    reelUrl: reelUrl || undefined,
    reelVideoId: vid.reelVideoId,
    registration: regRes.reg,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return { flash: existing ? `„${title}“ gespeichert.` : `„${title}“ angelegt – ist jetzt auf der Website.` };
}

export async function handleEventDelete(store: LedgerStore, form: FormData): Promise<Result> {
  const id = String(form.get("id") ?? "");
  if ((await bookingOf(store, id)).hasAny)
    return { error: "Dieses Event hat schon Anmeldungen und kann nicht gelöscht werden. Du kannst die Anmeldung pausieren." };
  const removed = await deleteStoredEvent(store, id);
  if (!removed) return { error: "Event nicht gefunden." };
  if (removed.imageId) await imageStore().remove(removed.imageId).catch(() => {});
  await deleteVideo(removed.reelVideoId);
  return { flash: `„${removed.title}“ gelöscht.` };
}

/** Änderungen an einem Code-Event verwerfen */
export async function handleEventReset(store: LedgerStore, form: FormData): Promise<Result> {
  const id = String(form.get("id") ?? "");
  const ov = (await readOverrides(store))[id];
  if (ov?.registration !== undefined && (await bookingOf(store, id)).hasAny)
    return { error: "Die Anmelde-Einstellungen wurden geändert und es gibt schon Anmeldungen – bitte die Werte einzeln im Formular anpassen statt alles zurückzusetzen." };
  const old = await updateJSON<Record<string, EventOverride>, EventOverride | undefined>(
    store,
    "event-overrides",
    () => ({}),
    (doc) => {
      const o = doc[id];
      delete doc[id];
      return o;
    },
  );
  if (!old) return { error: "Keine Änderungen gefunden." };
  if (old.imageId) await imageStore().remove(old.imageId).catch(() => {});
  await deleteVideo(old.reelVideoId);
  return { flash: "Änderungen zurückgesetzt." };
}

// ---------------------------------------------------------------------------
// Video-Upload in Stücken (vom Formular per fetch aufgerufen)

export async function handleVideoAction(req: Request, action: string, url: URL): Promise<Response> {
  const vs = videoStore();
  try {
    if (action === "video-init") {
      const { size, type } = (await req.json()) as { size?: number; type?: string };
      if (!Number.isFinite(size) || !size || size <= 0) return json({ error: "Leere Datei." }, 400);
      if (size > VIDEO_MAX) return json({ error: "Das Video ist zu groß (max. 150 MB). Bitte kürzer oder in 1080p exportieren." }, 400);
      const contentType = VIDEO_TYPES.includes(String(type)) ? String(type) : "video/mp4";
      const id = `rv-${crypto.randomUUID().slice(0, 13)}`;
      await vs.putMeta({ id, contentType, size, chunkSize: VIDEO_CHUNK, chunks: Math.ceil(size / VIDEO_CHUNK), complete: false });
      return json({ id, chunkSize: VIDEO_CHUNK });
    }

    const id = url.searchParams.get("id") ?? "";
    if (!/^rv-[a-z0-9-]+$/.test(id)) return json({ error: "Ungültige Video-ID." }, 400);
    const meta = await vs.getMeta(id);
    if (!meta) return json({ error: "Upload nicht gefunden." }, 404);
    if (meta.complete) return json({ error: "Video ist bereits fertig." }, 409);

    if (action === "video-chunk") {
      const n = Number(url.searchParams.get("n"));
      if (!Number.isInteger(n) || n < 0 || n >= meta.chunks) return json({ error: "Ungültiges Stück." }, 400);
      const data = await req.arrayBuffer();
      const expected = n === meta.chunks - 1 ? meta.size - n * meta.chunkSize : meta.chunkSize;
      if (data.byteLength !== expected) return json({ error: "Stück unvollständig – bitte erneut versuchen." }, 400);
      await vs.putChunk(id, n, data);
      return json({ ok: true });
    }

    if (action === "video-done") {
      for (let n = 0; n < meta.chunks; n++) {
        if (!(await vs.hasChunk(id, n))) return json({ error: `Teil ${n + 1} fehlt – bitte erneut hochladen.` }, 400);
      }
      await vs.putMeta({ ...meta, complete: true });
      return json({ ok: true });
    }
  } catch (err) {
    console.error("[video-upload]", err);
    return json({ error: "Upload fehlgeschlagen. Bitte erneut versuchen." }, 500);
  }
  return json({ error: "Unbekannte Aktion." }, 400);
}
