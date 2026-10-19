// Testmodus für StackBlitz / `npm run dev` ohne Netlify und ohne Stripe-Schlüssel.
// Wird NUR vom Dev-Server (astro.config.mjs → dev/api-dev-server.mjs) eingeschaltet.
// Auf Netlify ist GRUPPETTO_TESTMODUS nie gesetzt → dort läuft alles echt.
import fs from "node:fs";
import path from "node:path";
import type { LedgerStore } from "./registrations";

export const isTestMode = () => process.env.GRUPPETTO_TESTMODUS === "1";

export interface TestCheckout {
  id: string;
  eventId: string;
  reservationId: string;
  name: string;
  email: string;
  amount: number; // Cent
  productName: string;
  successUrl: string;
  cancelUrl: string;
}

export interface TestMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  sentAt: string;
  ref?: string;
}

// Auf globalThis, damit die Daten Hot-Reloads des Dev-Servers überleben.
// Ein Neustart des Dev-Servers leert alles (gewollt: frischer Test).
interface TestState {
  blobs: Map<string, { data: unknown; etag: string }>;
  checkouts: Map<string, TestCheckout>;
  outbox: TestMail[];
}
const g = globalThis as unknown as { __gtTest?: TestState };
const state: TestState = (g.__gtTest ??= { blobs: new Map(), checkouts: new Map(), outbox: [] });

// Events aus der Verwaltung (und ihre Bilder/Videos) sollen im Testmodus auch einen
// Neustart des Dev-Servers überleben → zusätzlich als Dateien in .testdaten/ ablegen.
// Anmeldungen/Zahlungen bleiben bewusst nur im Arbeitsspeicher (frischer Test).
const PERSIST_KEYS = new Set(["admin-events", "event-overrides"]);
export const testDataDir = () => path.join(process.cwd(), ".testdaten");
const fileFor = (key: string) => path.join(testDataDir(), `${key}.json`);

function loadPersisted(key: string) {
  if (!PERSIST_KEYS.has(key) || state.blobs.has(key)) return;
  try {
    const data = JSON.parse(fs.readFileSync(fileFor(key), "utf8"));
    state.blobs.set(key, { data, etag: crypto.randomUUID() });
  } catch {
    /* noch nichts gespeichert */
  }
}

function persist(key: string, data: unknown) {
  if (!PERSIST_KEYS.has(key)) return;
  fs.mkdirSync(testDataDir(), { recursive: true });
  fs.writeFileSync(fileFor(key), JSON.stringify(data, null, 2));
}

/** Einfacher Datei-Speicher für Bilder/Videos im Testmodus */
export const testFiles = {
  dir: (bucket: string) => path.join(testDataDir(), bucket),
  async get(bucket: string, key: string): Promise<{ data: ArrayBuffer; meta: Record<string, string> } | null> {
    try {
      const file = path.join(testFiles.dir(bucket), key);
      const buf = fs.readFileSync(file);
      let meta: Record<string, string> = {};
      try {
        meta = JSON.parse(fs.readFileSync(`${file}.meta.json`, "utf8"));
      } catch {
        /* ohne Metadaten */
      }
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, meta };
    } catch {
      return null;
    }
  },
  async put(bucket: string, key: string, data: ArrayBuffer | Uint8Array, meta: Record<string, string> = {}) {
    const file = path.join(testFiles.dir(bucket), key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data instanceof Uint8Array ? data : new Uint8Array(data));
    fs.writeFileSync(`${file}.meta.json`, JSON.stringify(meta));
  },
  exists(bucket: string, key: string) {
    return fs.existsSync(path.join(testFiles.dir(bucket), key));
  },
  async remove(bucket: string, keyOrPrefix: string) {
    fs.rmSync(path.join(testFiles.dir(bucket), keyOrPrefix), { recursive: true, force: true });
    fs.rmSync(path.join(testFiles.dir(bucket), `${keyOrPrefix}.meta.json`), { force: true });
  },
};

export const memoryStore: LedgerStore = {
  async getWithMetadata(key) {
    loadPersisted(key);
    const entry = state.blobs.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag } : null;
  },
  async setJSON(key, value, opts) {
    loadPersisted(key);
    const current = state.blobs.get(key);
    if (opts && "onlyIfNew" in opts && opts.onlyIfNew && current) return { modified: false };
    if (opts && "onlyIfMatch" in opts && opts.onlyIfMatch && current?.etag !== opts.onlyIfMatch) return { modified: false };
    const etag = crypto.randomUUID();
    state.blobs.set(key, { data: structuredClone(value), etag });
    persist(key, value);
    return { modified: true, etag };
  },
  async list({ prefix }) {
    return { blobs: [...state.blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  },
};

export const testCheckouts = state.checkouts;
export const testOutbox = state.outbox;
