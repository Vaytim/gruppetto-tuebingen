// Website-Einstellungen, die ohne Code-Änderung in der Verwaltung (/api/teilnehmer)
// umgeschaltet werden. Gespeichert im selben Netlify-Blobs-Speicher wie die Anmeldungen.
import { type LedgerStore, updateJSON } from "./registrations";

export interface SiteSettings {
  /** Off-Season: Rides-Seite zeigt "Season Closed" über dem Rides-Block */
  offseason: boolean;
  /** Rookie Ride: true = nächster Rookie Ride ist ausgebucht, false = noch Plätze frei */
  rookieFull: boolean;
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
