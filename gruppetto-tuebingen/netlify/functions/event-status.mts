// GET /api/event-status                 → freie Plätze aller Events mit Anmeldung
// GET /api/event-status?event=X&ref=Y   → Status einer einzelnen Anmeldung (Danke-Seite)
import type { Config } from "@netlify/functions";
import { registrationClosesAt } from "../../src/data/events";
import { findLiveEvent, registeredEvents } from "../lib/event-store";
import { readLedger, seatsTaken } from "../lib/registrations";
import { json, ledgerStore } from "../lib/services";
import { isTestMode } from "../lib/testmode";

export default async (req: Request) => {
  const url = new URL(req.url);
  const store = ledgerStore();
  const ref = url.searchParams.get("ref");

  if (ref) {
    const event = await findLiveEvent(store, url.searchParams.get("event") ?? "");
    if (!event?.registration) return json({ status: "unknown" }, 404);
    const title = `${event.title} · ${event.dateLabel}`;
    const ledger = await readLedger(store, event.id, event.registration.firstStartNumber);
    const paid = ledger.paid.find((p) => p.reservationId === ref);
    if (paid)
      return json({
        status: "paid",
        title,
        startNumber: paid.startNumber,
        mailSent: paid.mailSent,
        ...(isTestMode() && { testMailUrl: `/api/test-postfach?ref=${encodeURIComponent(ref)}` }),
      });
    if (ledger.pending[ref]) return json({ status: "pending", title });
    return json({ status: "unknown" });
  }

  const now = Date.now();
  const result: Record<string, { capacity: number; taken: number; remaining: number; open: boolean }> = {};
  await Promise.all(
    (await registeredEvents(store))
      .filter((e) => registrationClosesAt(e).getTime() > now - 86_400_000)
      .map(async (e) => {
        const reg = e.registration;
        const ledger = await readLedger(store, e.id, reg.firstStartNumber);
        const taken = seatsTaken(ledger, now);
        result[e.id] = {
          capacity: reg.capacity,
          taken,
          remaining: Math.max(0, reg.capacity - taken),
          open: !reg.paused && now < registrationClosesAt(e).getTime() && taken < reg.capacity,
        };
      }),
  );
  return json(result);
};

export const config: Config = { path: "/api/event-status" };
