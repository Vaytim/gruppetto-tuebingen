// Events, die in der Verwaltung (/api/teilnehmer?tab=events) angelegt werden.
// Gespeichert in Netlify Blobs; Bilder in einem eigenen Blob-Speicher.
// Die Events aus src/data/events.ts ("im Code") gibt es weiterhin – beide Listen
// werden für die Website zusammengeführt.
import { getStore } from "@netlify/blobs";
import { events as codeEvents, germanDateLabel, type GruppettoEvent } from "../../src/data/events";
import { type LedgerStore, updateJSON } from "./registrations";
import { isTestMode } from "./testmode";

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
  createdAt: string;
  updatedAt: string;
}

interface StoredEvents {
  events: StoredEvent[];
}

const KEY = "admin-events";

export async function readStoredEvents(store: LedgerStore): Promise<StoredEvent[]> {
  const entry = await store.getWithMetadata(KEY, { type: "json" });
  return ((entry?.data as StoredEvents | undefined)?.events ?? []).slice();
}

export async function saveStoredEvent(store: LedgerStore, ev: StoredEvent): Promise<void> {
  await updateJSON<StoredEvents, void>(store, KEY, () => ({ events: [] }), (doc) => {
    const i = doc.events.findIndex((e) => e.id === ev.id);
    if (i >= 0) doc.events[i] = ev;
    else doc.events.push(ev);
  });
}

export async function deleteStoredEvent(store: LedgerStore, id: string): Promise<StoredEvent | undefined> {
  return updateJSON<StoredEvents, StoredEvent | undefined>(store, KEY, () => ({ events: [] }), (doc) => {
    const i = doc.events.findIndex((e) => e.id === id);
    return i >= 0 ? doc.events.splice(i, 1)[0] : undefined;
  });
}

export const imageUrl = (imageId: string) => `/api/event-image?id=${encodeURIComponent(imageId)}`;

export function toPublicEvent(e: StoredEvent): GruppettoEvent {
  return {
    id: e.id,
    title: e.title,
    dateISO: e.dateISO,
    dateLabel: germanDateLabel(e.dateISO),
    time: e.time ? `${e.time} Uhr` : "",
    location: e.location ? (/^treffpunkt/i.test(e.location) ? e.location : `Treffpunkt: ${e.location}`) : "",
    level: "",
    description: e.description,
    image: e.imageId ? imageUrl(e.imageId) : "",
    strava: e.strava || undefined,
    source: "admin",
  };
}

/** Alle Events für die Website: aus dem Code + aus der Verwaltung, nach Datum sortiert. */
export async function allEvents(store: LedgerStore): Promise<GruppettoEvent[]> {
  const stored = (await readStoredEvents(store)).map(toPublicEvent);
  const code = codeEvents.map((e) => ({ ...e, source: "code" as const }));
  return [...code, ...stored].sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
}

// ---------------------------------------------------------------------------
// Bildspeicher

export interface ImageStore {
  get(id: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
  put(id: string, data: ArrayBuffer, contentType: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const g = globalThis as unknown as { __gtImages?: Map<string, { data: ArrayBuffer; contentType: string }> };

export function imageStore(): ImageStore {
  if (isTestMode()) {
    const m = (g.__gtImages ??= new Map());
    return {
      async get(id) {
        return m.get(id) ?? null;
      },
      async put(id, data, contentType) {
        m.set(id, { data, contentType });
      },
      async remove(id) {
        m.delete(id);
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
