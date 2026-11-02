// Einfache Bremse gegen Missbrauch (Passwort-Raten, massenhaftes Reservieren).
// Zählt Versuche pro Anschluss (IP) in Netlify Blobs – so gilt die Grenze für alle
// Function-Instanzen gemeinsam. Die IP wird nur als Hash gespeichert.
import type { LedgerStore } from "./registrations";

interface Bucket {
  hits: number[]; // Zeitpunkte der Versuche (ms)
  lockedUntil?: number;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unbekannt";
}

async function keyFor(scope: string, ip: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gruppetto:${scope}:${ip}`));
  const hex = [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ratelimit/${scope}/${hex}`;
}

async function read(store: LedgerStore, key: string): Promise<Bucket> {
  const res = await store.getWithMetadata(key, { type: "json" }).catch(() => null);
  return (res?.data as Bucket | undefined) ?? { hits: [] };
}

/**
 * Gesperrt? Liefert die restlichen Minuten der Sperre, sonst 0.
 */
export async function lockedMinutes(store: LedgerStore, scope: string, req: Request): Promise<number> {
  const b = await read(store, await keyFor(scope, clientIp(req)));
  const left = (b.lockedUntil ?? 0) - Date.now();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/**
 * Zählt einen Versuch. Werden innerhalb von `windowMs` mehr als `max` Versuche gezählt,
 * ist der Anschluss für `lockMs` gesperrt. Rückgabe: true = jetzt gesperrt.
 */
export async function hit(
  store: LedgerStore,
  scope: string,
  req: Request,
  { max, windowMs, lockMs }: { max: number; windowMs: number; lockMs: number },
): Promise<boolean> {
  const key = await keyFor(scope, clientIp(req));
  const now = Date.now();
  const b = await read(store, key);
  b.hits = b.hits.filter((t) => now - t < windowMs);
  b.hits.push(now);
  if (b.hits.length >= max) {
    b.lockedUntil = now + lockMs;
    b.hits = [];
  }
  await store.setJSON(key, b).catch(() => {});
  return (b.lockedUntil ?? 0) > now;
}

/** Nach erfolgreichem Login den Zähler zurücksetzen. */
export async function reset(store: LedgerStore, scope: string, req: Request) {
  await store.setJSON(await keyFor(scope, clientIp(req)), { hits: [] }).catch(() => {});
}
