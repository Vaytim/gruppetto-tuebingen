// POST /api/medien  { eventId, password } → { url } des Medien-Ordners (Fotos & Videos)
// Jedes Event hat seinen eigenen Ordner und sein eigenes Passwort (Verwaltung → Events → Event bearbeiten).
// Nach 10 falschen Versuchen ist der Anschluss 15 Minuten gesperrt.
import type { Config } from "@netlify/functions";
import { findLiveEvent } from "../lib/event-store";
import { hit, lockedMinutes, reset } from "../lib/ratelimit";
import { json, ledgerStore } from "../lib/services";

function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const LIMIT = { max: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "null" && origin !== new URL(req.url).origin) return json({ error: "Nicht erlaubt" }, 403);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const eventId = String(body.eventId ?? "").slice(0, 120);
  const password = String(body.password ?? "").slice(0, 200);

  const store = ledgerStore();
  const locked = await lockedMinutes(store, "medien", req);
  if (locked) return json({ error: `Zu viele Versuche. Bitte in ${locked} Minute${locked === 1 ? "" : "n"} noch einmal probieren.` }, 429);

  const event = await findLiveEvent(store, eventId);
  if (!event?.mediaUrl || !event.mediaPassword) return json({ error: "Für dieses Event gibt es (noch) keine Fotos und Videos." }, 404);

  if (!sameText(password.trim(), event.mediaPassword)) {
    await new Promise((r) => setTimeout(r, 500));
    if (await hit(store, "medien", req, LIMIT)) return json({ error: "Zu viele Versuche. Bitte in 15 Minuten noch einmal probieren." }, 429);
    return json({ error: "Das Passwort stimmt leider nicht." }, 401);
  }
  await reset(store, "medien", req);
  return json({ url: event.mediaUrl });
};

export const config: Config = { path: "/api/medien" };
