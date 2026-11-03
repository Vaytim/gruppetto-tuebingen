// POST /api/medien  { eventId, password } → { url } des Medien-Ordners (Fotos & Videos)
// Das Passwort wird in der Verwaltung festgelegt (Reiter „Anmeldungen & Zahlungen“ → Website).
// Nach 10 falschen Versuchen ist der Anschluss 15 Minuten gesperrt.
import type { Config } from "@netlify/functions";
import { findLiveEvent } from "../lib/event-store";
import { hit, lockedMinutes, reset } from "../lib/ratelimit";
import { json, ledgerStore } from "../lib/services";
import { checkMediaPassword } from "../lib/settings";

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
  if (!event?.mediaUrl) return json({ error: "Für dieses Event gibt es (noch) keine Fotos und Videos." }, 404);

  if (!(await checkMediaPassword(store, password))) {
    await new Promise((r) => setTimeout(r, 500));
    if (await hit(store, "medien", req, LIMIT)) return json({ error: "Zu viele Versuche. Bitte in 15 Minuten noch einmal probieren." }, 429);
    return json({ error: "Das Passwort stimmt leider nicht." }, 401);
  }
  await reset(store, "medien", req);
  return json({ url: event.mediaUrl });
};

export const config: Config = { path: "/api/medien" };
