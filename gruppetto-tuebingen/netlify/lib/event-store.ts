// Events, die in der Verwaltung (/api/teilnehmer?tab=events) angelegt oder bearbeitet werden.
// Gespeichert in Netlify Blobs (dauerhaft); Bilder und Reel-Videos in eigenen Blob-Speichern.
// Die Events aus src/data/events.ts ("im Code") gibt es weiterhin – ihre Texte, Bilder und
// Links lassen sich in der Verwaltung überschreiben ("event-overrides"). Datum und Anmeldung
// bleiben dort im Code.
import { getStore } from "@netlify/blobs";
import { events as codeEvents, germanDateLabel, type GruppettoEvent } from "../../src/data/events";
import { type LedgerStore, updateJSON } from "./registrations";
import { isTestMode, testFiles } from "./testmode";

export interface StoredEvent {
  id: string;
  title: string;
  dateISO: string; // YYYY-MM-DD
  time: string; // HH:MM
  location?: string;
  description: string;
  /** Bild-ID im Bildspeicher (z. B. "ev-abc123-1729.jpg") */
  imageId?: string;
  strava?: string;
  /** Link zum Instagram-Reel */
  reelUrl?: string;
  /** Hochgeladenes Reel-Video (spielt beim Hovern stumm ab) */
  reelVideoId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Änderungen an einem Event aus dem Code */
export interface EventOverride {
  title?: string;
  description?: string;
  location?: string;
  imageId?: string;
  strava?: string;
  reelUrl?: string;
  reelVideoId?: string;
  updatedAt: string;
}

/** Was die Website über ein Event bekommt */
export interface PublicEventData extends GruppettoEvent {
  reelUrl?: string;
  reelVideo?: string;
}

const KEY = "admin-events";
const OVERRIDES = "event-overrides";

export async function readStoredEvents(store: LedgerStore): Promise<StoredEvent[]> {
  const entry = await store.getWithMetadata(KEY, { type: "json" });
  return ((entry?.data as { events?: StoredEvent[] } | undefined)?.events ?? []).slice();
}

export async function saveStoredEvent(store: LedgerStore, ev: StoredEvent): Promise<void> {
  await updateJSON<{ events: StoredEvent[] }, void>(store, KEY, () => ({ events: [] }), (doc) => {
    const i = doc.events.findIndex((e) => e.id === ev.id);
    if (i >= 0) doc.events[i] = ev;
    else doc.events.push(ev);
  });
}

export async function deleteStoredEvent(store: LedgerStore, id: string): Promise<StoredEvent | undefined> {
  return updateJSON<{ events: StoredEvent[] }, StoredEvent | undefined>(store, KEY, () => ({ events: [] }), (doc) => {
    const i = doc.events.findIndex((e) => e.id === id);
    return i >= 0 ? doc.events.splice(i, 1)[0] : undefined;
  });
}

export async function readOverrides(store: LedgerStore): Promise<Record<string, EventOverride>> {
  const entry = await store.getWithMetadata(OVERRIDES, { type: "json" });
  return { ...((entry?.data as Record<string, EventOverride> | undefined) ?? {}) };
}

export async function saveOverride(store: LedgerStore, id: string, ov: EventOverride): Promise<void> {
  await updateJSON<Record<string, EventOverride>, void>(store, OVERRIDES, () => ({}), (doc) => {
    doc[id] = ov;
  });
}

export const imageUrl = (imageId: string) => `/api/event-image?id=${encodeURIComponent(imageId)}`;
export const videoUrl = (videoId: string) => `/api/event-video?id=${encodeURIComponent(videoId)}`;

const withTreffpunkt = (loc?: string) => (loc ? (/^treffpunkt/i.test(loc) ? loc : `Treffpunkt: ${loc}`) : "");

export function toPublicEvent(e: StoredEvent): PublicEventData {
  return {
    id: e.id,
    title: e.title,
    dateISO: e.dateISO,
    dateLabel: germanDateLabel(e.dateISO),
    time: e.time ? `${e.time} Uhr` : "",
    location: withTreffpunkt(e.location),
    level: "",
    description: e.description,
    image: e.imageId ? imageUrl(e.imageId) : "",
    strava: e.strava || undefined,
    reelUrl: e.reelUrl || undefined,
    reelVideo: e.reelVideoId ? videoUrl(e.reelVideoId) : undefined,
    source: "admin",
  };
}

export function applyOverride(e: GruppettoEvent, ov?: EventOverride): PublicEventData {
  const base: PublicEventData = { ...e, source: "code" };
  if (!ov) return base;
  return {
    ...base,
    title: ov.title || e.title,
    description: ov.description ?? e.description,
    location: ov.location !== undefined ? withTreffpunkt(ov.location) : e.location,
    image: ov.imageId ? imageUrl(ov.imageId) : e.image,
    strava: ov.strava !== undefined ? ov.strava || undefined : e.strava,
    reelUrl: ov.reelUrl || undefined,
    reelVideo: ov.reelVideoId ? videoUrl(ov.reelVideoId) : undefined,
  };
}

/** Alle Events für die Website: aus dem Code (+ Änderungen) und aus der Verwaltung, nach Datum sortiert. */
export async function allEvents(store: LedgerStore): Promise<PublicEventData[]> {
  const [stored, overrides] = await Promise.all([readStoredEvents(store), readOverrides(store)]);
  const code = codeEvents.map((e) => applyOverride(e, overrides[e.id]));
  return [...code, ...stored.map(toPublicEvent)].sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
}

// ---------------------------------------------------------------------------
// Bildspeicher

export interface ImageStore {
  get(id: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
  put(id: string, data: ArrayBuffer, contentType: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function imageStore(): ImageStore {
  if (isTestMode()) {
    return {
      async get(id) {
        const f = await testFiles.get("bilder", id);
        return f ? { data: f.data, contentType: f.meta.contentType ?? "image/jpeg" } : null;
      },
      async put(id, data, contentType) {
        await testFiles.put("bilder", id, data, { contentType });
      },
      async remove(id) {
        await testFiles.remove("bilder", id);
      },
    };
  }
  const s = getStore({ name: "event-images", consistency: "strong" });
  return {
    async get(id) {
      const r = await s.getWithMetadata(id, { type: "arrayBuffer" });
      if (!r) return null;
      return { data: r.data as ArrayBuffer, contentType: String(r.metadata?.contentType ?? "image/jpeg") };
    },
    async put(id, data, contentType) {
      await s.set(id, data, { metadata: { contentType } });
    },
    async remove(id) {
      await s.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Reel-Videos – in Stücken gespeichert, weil Netlify Functions pro Anfrage/Antwort
// nur ~6 MB übertragen. Hochladen und Abspielen laufen deshalb stückweise.

/** Größe eines Stücks. Klein genug für eine Function-Anfrage (inkl. Base64-Aufschlag). */
export const VIDEO_CHUNK = 3 * 1024 * 1024;
export const VIDEO_MAX = 150 * 1024 * 1024;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export interface VideoMeta {
  id: string;
  contentType: string;
  size: number;
  chunkSize: number;
  chunks: number;
  complete: boolean;
}

export interface VideoStore {
  getMeta(id: string): Promise<VideoMeta | null>;
  putMeta(meta: VideoMeta): Promise<void>;
  getChunk(id: string, n: number): Promise<ArrayBuffer | null>;
  hasChunk(id: string, n: number): Promise<boolean>;
  putChunk(id: string, n: number, data: ArrayBuffer): Promise<void>;
  remove(id: string, chunks: number): Promise<void>;
}

export function videoStore(): VideoStore {
  if (isTestMode()) {
    return {
      async getMeta(id) {
        const f = await testFiles.get("videos", `${id}/meta`);
        return f ? (JSON.parse(new TextDecoder().decode(f.data)) as VideoMeta) : null;
      },
      async putMeta(meta) {
        await testFiles.put("videos", `${meta.id}/meta`, new TextEncoder().encode(JSON.stringify(meta)));
      },
      async getChunk(id, n) {
        return (await testFiles.get("videos", `${id}/${n}`))?.data ?? null;
      },
      async putChunk(id, n, data) {
        await testFiles.put("videos", `${id}/${n}`, data);
      },
      async hasChunk(id, n) {
        return testFiles.exists("videos", `${id}/${n}`);
      },
      async remove(id) {
        await testFiles.remove("videos", id);
      },
    };
  }
  const s = getStore({ name: "event-videos", consistency: "strong" });
  return {
    async getMeta(id) {
      return ((await s.get(`${id}/meta`, { type: "json" })) as VideoMeta | null) ?? null;
    },
    async putMeta(meta) {
      await s.setJSON(`${meta.id}/meta`, meta);
    },
    async getChunk(id, n) {
      return ((await s.get(`${id}/${n}`, { type: "arrayBuffer" })) as ArrayBuffer | null) ?? null;
    },
    async putChunk(id, n, data) {
      await s.set(`${id}/${n}`, data);
    },
    async hasChunk(id, n) {
      return (await s.getMetadata(`${id}/${n}`)) !== null;
    },
    async remove(id, chunks) {
      await Promise.all([s.delete(`${id}/meta`), ...Array.from({ length: chunks }, (_, n) => s.delete(`${id}/${n}`))]);
    },
  };
}

export async function deleteVideo(id: string | undefined) {
  if (!id) return;
  const vs = videoStore();
  const meta = await vs.getMeta(id).catch(() => null);
  await vs.remove(id, meta?.chunks ?? 0).catch(() => {});
}
