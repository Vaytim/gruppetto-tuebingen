// Verwaltung → Reiter „Events“: Events anlegen, bearbeiten, löschen – ohne Code.
import { events as codeEvents, germanDateLabel } from "../../src/data/events";
import {
  type StoredEvent,
  deleteStoredEvent,
  imageStore,
  imageUrl,
  readStoredEvents,
  saveStoredEvent,
} from "./event-store";
import type { LedgerStore } from "./registrations";
import { escapeHtml as h } from "./services";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const todayISO = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()); // YYYY-MM-DD

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
.ev-form{display:grid;grid-template-columns:1fr 1fr;gap:1rem;background:var(--alt);border-radius:14px;padding:1.2rem;margin-bottom:1rem}
.ev-form label{display:grid;gap:.35rem;font-size:.9rem;color:var(--muted)}
.ev-form .full{grid-column:1/-1}
.ev-form input,.ev-form textarea{width:100%;padding:.65rem .8rem;border:1px solid var(--line);background:var(--bg);color:var(--text);font:inherit;border-radius:8px}
.ev-form textarea{min-height:7rem;resize:vertical}
.ev-form input:focus,.ev-form textarea:focus{outline:2px solid var(--text);outline-offset:1px}
.ev-form .row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.ev-preview{max-width:240px;border-radius:8px;display:block;margin-top:.4rem}
.ev-thumb{width:72px;height:48px;object-fit:cover;border-radius:6px;display:block;background:var(--bg)}
td form{display:inline}
.btn.danger{background:#3a2420;color:var(--warn)}
@media (max-width:700px){.ev-form{grid-template-columns:1fr}}
`;

export function tabNav(active: "zahlungen" | "events") {
  return `<nav class="tabs" aria-label="Bereiche">
  <a href="?" ${active === "zahlungen" ? 'aria-current="page"' : ""}>Anmeldungen &amp; Zahlungen</a>
  <a href="?tab=events" ${active === "events" ? 'aria-current="page"' : ""}>Events</a>
</nav>`;
}

export async function eventsAdminBody(store: LedgerStore, opts: { editId?: string; flash?: string; error?: string } = {}) {
  const stored = await readStoredEvents(store);
  const editing = opts.editId ? stored.find((e) => e.id === opts.editId) : undefined;
  const today = todayISO();

  type Row = { id: string; title: string; dateISO: string; time: string; image: string; strava?: string; admin?: StoredEvent };
  const rows: Row[] = [
    ...codeEvents.map((e) => ({ id: e.id, title: e.title, dateISO: e.dateISO, time: e.time, image: e.image, strava: e.strava })),
    ...stored.map((e) => ({ id: e.id, title: e.title, dateISO: e.dateISO, time: e.time ? `${e.time} Uhr` : "", image: e.imageId ? imageUrl(e.imageId) : "", strava: e.strava, admin: e })),
  ].sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  const list = rows
    .map((r) => {
      const past = r.dateISO < today;
      return `<tr>
  <td>${r.image ? `<img class="ev-thumb" src="${h(r.image)}" alt="">` : '<span class="ev-thumb"></span>'}</td>
  <td>${h(germanDateLabel(r.dateISO))}${r.time ? ` <span class="muted">· ${h(r.time)}</span>` : ""}</td>
  <td style="white-space:normal"><b>${h(r.title)}</b>${r.strava ? ` <a href="${h(r.strava)}" target="_blank" rel="noopener">Strava ↗</a>` : ""}</td>
  <td><span class="tag ${past ? "wait" : ""}">${past ? "vergangen" : "kommend"}</span></td>
  <td>${
    r.admin
      ? `<a class="btn sec" href="?tab=events&edit=${encodeURIComponent(r.id)}">Bearbeiten</a>
         <form method="post" action="?tab=events&action=event-delete" onsubmit="return confirm('Event „${h(r.title).replace(/'/g, "")}“ wirklich löschen?')">
         <input type="hidden" name="id" value="${h(r.id)}"><button class="btn danger">Löschen</button></form>`
      : '<span class="muted">im Code (src/data/events.ts)</span>'
  }</td>
</tr>`;
    })
    .join("");

  const e = editing;
  const form = `<form class="ev-form" method="post" action="?tab=events&action=event-save" enctype="multipart/form-data" id="ev-form">
  ${e ? `<input type="hidden" name="id" value="${h(e.id)}">` : ""}
  <label class="full">Titel *<input name="title" required maxlength="120" value="${h(e?.title ?? "")}"></label>
  <label>Datum *<input type="date" name="date" required value="${h(e?.dateISO ?? "")}"></label>
  <label>Uhrzeit<input type="time" name="time" value="${h(e?.time ?? "")}"></label>
  <label>Treffpunkt <span class="muted">(optional)</span><input name="location" maxlength="120" value="${h(e?.location ?? "")}" placeholder="z. B. Finanzamt Tübingen"></label>
  <label>Strava-Link <span class="muted">(optional)</span><input type="url" name="strava" maxlength="300" value="${h(e?.strava ?? "")}" placeholder="https://www.strava.com/…"></label>
  <label class="full">Beschreibung<textarea name="description" maxlength="2000">${h(e?.description ?? "")}</textarea></label>
  <label class="full">Bild <span class="muted">(JPG/PNG/WebP – wird automatisch verkleinert)</span>
    <input type="file" name="image" accept="image/jpeg,image/png,image/webp" id="ev-image">
    ${e?.imageId ? `<img class="ev-preview" src="${h(imageUrl(e.imageId))}" alt="Aktuelles Bild" id="ev-preview">
      <span class="row"><input type="checkbox" name="removeImage" value="1" id="ev-remove" style="width:auto"><label for="ev-remove" style="display:inline">Bild entfernen</label></span>`
      : '<img class="ev-preview" id="ev-preview" alt="" hidden>'}
  </label>
  <div class="row full">
    <button class="btn" id="ev-submit">${e ? "Änderungen speichern" : "Event anlegen"}</button>
    ${e ? '<a class="btn sec" href="?tab=events">Abbrechen</a>' : ""}
  </div>
</form>
<script>
// Bild im Browser auf max. 1600 px verkleinern, bevor es hochgeladen wird
(() => {
  const input = document.getElementById("ev-image");
  const preview = document.getElementById("ev-preview");
  const btn = document.getElementById("ev-submit");
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    btn.disabled = true; btn.textContent = "Bild wird vorbereitet …";
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "event.jpg", { type: "image/jpeg" }));
      input.files = dt.files;
      preview.src = URL.createObjectURL(blob); preview.hidden = false;
    } catch (e) { /* dann wird das Original hochgeladen */ }
    btn.disabled = false; btn.textContent = ${JSON.stringify(e ? "Änderungen speichern" : "Event anlegen")};
  });
})();
</script>`;

  return `${opts.flash ? `<div class="note">${h(opts.flash)}</div>` : ""}
${opts.error ? `<div class="note warn">${h(opts.error)}</div>` : ""}
<h2 style="margin-top:0">${e ? `Event bearbeiten: ${h(e.title)}` : "Neues Event"}</h2>
${form}
<h2>Alle Events</h2>
<p class="muted">Auf der Website erscheinen alle kommenden Events (ab dem nächsten) und die letzten 4 vergangenen.</p>
<div class="scroll"><table><thead><tr><th></th><th>Datum</th><th>Event</th><th>Status</th><th></th></tr></thead>
<tbody>${list || '<tr><td colspan="5" class="muted">Noch keine Events.</td></tr>'}</tbody></table></div>`;
}

/** POST ?action=event-save – Rückgabe: Meldung oder Fehler */
export async function handleEventSave(store: LedgerStore, form: FormData): Promise<{ flash?: string; error?: string; editId?: string }> {
  const str = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);
  const id = str("id", 80);
  const title = str("title", 120);
  const dateISO = str("date", 10);
  const time = str("time", 5);
  const location = str("location", 120);
  const description = str("description", 2000);
  const strava = str("strava", 300);

  if (title.length < 2) return { error: "Bitte einen Titel angeben.", editId: id || undefined };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: "Bitte ein gültiges Datum angeben.", editId: id || undefined };
  if (time && !/^\d{2}:\d{2}$/.test(time)) return { error: "Bitte eine gültige Uhrzeit angeben.", editId: id || undefined };
  if (strava && !/^https:\/\/[^\s]+$/i.test(strava)) return { error: "Der Strava-Link muss mit https:// beginnen.", editId: id || undefined };

  const stored = await readStoredEvents(store);
  const existing = id ? stored.find((e) => e.id === id) : undefined;
  if (id && !existing) return { error: "Dieses Event gibt es nicht mehr." };

  let newId = existing?.id;
  if (!newId) {
    const base = `${dateISO}-${slug(title) || "event"}`;
    const taken = new Set([...codeEvents.map((e) => e.id), ...stored.map((e) => e.id)]);
    newId = base;
    for (let n = 2; taken.has(newId); n++) newId = `${base}-${n}`;
  }

  // Bild
  const images = imageStore();
  let imageId = existing?.imageId;
  const file = form.get("image");
  if (file && typeof file === "object" && (file as File).size > 0) {
    const f = file as File;
    const ext = IMAGE_TYPES[f.type];
    if (!ext) return { error: "Bitte ein Bild als JPG, PNG oder WebP hochladen.", editId: id || undefined };
    if (f.size > MAX_IMAGE_BYTES) return { error: "Das Bild ist zu groß (max. 8 MB).", editId: id || undefined };
    const nextId = `ev-${newId.replace(/[^a-z0-9-]/g, "")}-${Date.now()}.${ext}`;
    await images.put(nextId, await f.arrayBuffer(), f.type);
    if (imageId) await images.remove(imageId).catch(() => {});
    imageId = nextId;
  } else if (form.get("removeImage") && imageId) {
    await images.remove(imageId).catch(() => {});
    imageId = undefined;
  }

  const now = new Date().toISOString();
  await saveStoredEvent(store, {
    id: newId,
    title,
    dateISO,
    time,
    location: location || undefined,
    description,
    imageId,
    strava: strava || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return { flash: existing ? `„${title}“ gespeichert.` : `„${title}“ angelegt – ist jetzt auf der Events-Seite.` };
}

export async function handleEventDelete(store: LedgerStore, form: FormData): Promise<{ flash?: string; error?: string }> {
  const id = String(form.get("id") ?? "");
  const removed = await deleteStoredEvent(store, id);
  if (!removed) return { error: "Event nicht gefunden." };
  if (removed.imageId) await imageStore().remove(removed.imageId).catch(() => {});
  return { flash: `„${removed.title}“ gelöscht.` };
}
