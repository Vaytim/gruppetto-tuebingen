// Website-Einstellungen, die ohne Code-Änderung in der Verwaltung (/api/teilnehmer)
// umgeschaltet werden. Gespeichert im selben Netlify-Blobs-Speicher wie die Anmeldungen.
import { type LedgerStore, updateJSON } from "./registrations";

export interface SiteSettings {
  /** Off-Season: Rides-Seite zeigt "Season Closed" über dem Rides-Block */
  offseason: boolean;
  /** Rookie Ride: true = nächster Rookie Ride ist ausgebucht, false = noch Plätze frei */
  rookieFull: boolean;
  /** Passwort für „Fotos & Videos“ – nur als Hash gespeichert (PBKDF2, mit Salt) */
  mediaPassword?: { salt: string; hash: string; setAt: string };
  updatedAt?: string;
}

const KEY = "site-settings";
const DEFAULTS: SiteSettings = { offseason: false, rookieFull: false };

export async function readSettings(store: LedgerStore): Promise<SiteSettings> {
  const entry = await store.getWithMetadata(KEY, { type: "json" });
  return { ...DEFAULTS, ...((entry?.data as Partial<SiteSettings> | undefined) ?? {}) };
}

export async function updateSettings(store: LedgerStore, patch: Partial<SiteSettings>): Promise<SiteSettings> {
  return updateJSON<SiteSettings, SiteSettings>(store, KEY, () => ({ ...DEFAULTS }), (doc) => {
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    return { ...doc };
  });
}

// ---------- Medien-Passwort ----------
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function pbkdf2(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256));
}

export async function setMediaPassword(store: LedgerStore, password: string): Promise<SiteSettings> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return updateSettings(store, { mediaPassword: { salt, hash: await pbkdf2(password, salt), setAt: new Date().toISOString() } });
}

export async function checkMediaPassword(store: LedgerStore, password: string): Promise<boolean> {
  const mp = (await readSettings(store)).mediaPassword;
  if (!mp || !password) return false;
  const hash = await pbkdf2(password, mp.salt);
  let diff = hash.length ^ mp.hash.length;
  for (let i = 0; i < Math.min(hash.length, mp.hash.length); i++) diff |= hash.charCodeAt(i) ^ mp.hash.charCodeAt(i);
  return diff === 0;
}
