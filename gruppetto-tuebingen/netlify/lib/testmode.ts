// Testmodus für StackBlitz / `npm run dev` ohne Netlify und ohne Stripe-Schlüssel.
// Wird NUR vom Dev-Server (astro.config.mjs → dev/api-dev-server.mjs) eingeschaltet.
// Auf Netlify ist GRUPPETTO_TESTMODUS nie gesetzt → dort läuft alles echt.
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

export const memoryStore: LedgerStore = {
  async getWithMetadata(key) {
    const entry = state.blobs.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag } : null;
  },
  async setJSON(key, value, opts) {
    const current = state.blobs.get(key);
    if (opts && "onlyIfNew" in opts && opts.onlyIfNew && current) return { modified: false };
    if (opts && "onlyIfMatch" in opts && opts.onlyIfMatch && current?.etag !== opts.onlyIfMatch) return { modified: false };
    const etag = crypto.randomUUID();
    state.blobs.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  },
};

export const testCheckouts = state.checkouts;
export const testOutbox = state.outbox;
