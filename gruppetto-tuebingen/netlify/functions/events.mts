// GET /api/events – alle Events (aus dem Code + aus der Verwaltung) für die Website.
import type { Config } from "@netlify/functions";
import { registrationClosesAt } from "../../src/data/events";
import { allEvents } from "../lib/event-store";
import { json, ledgerStore } from "../lib/services";

export default async () => {
  const events = await allEvents(ledgerStore());
  // Preise/Plätze bleiben serverseitig – nur das, was die Seite anzeigen muss
  return json(
    events.map(({ registration, ...e }) => ({
      ...e,
      registration: registration
        ? { price: registration.price, closesAt: registrationClosesAt({ ...e, registration }).toISOString() }
        : undefined,
    })),
  );
};

export const config: Config = { path: "/api/events" };
