// POST /api/checkout  { eventId, name, email, acceptTerms }
// Prüft freie Plätze, reserviert einen Platz für 30 Minuten und gibt die
// Stripe-Checkout-URL zurück, auf die der Browser weitergeleitet wird.
import type { Config } from "@netlify/functions";
import { findEvent, registrationClosesAt } from "../../src/data/events";
import {
  ConflictError,
  SoldOutError,
  releaseSeat,
  reserveSeat,
  updateLedger,
} from "../lib/registrations";
import { json, ledgerStore, siteUrl, stripe } from "../lib/services";

const HOLD_MINUTES = 30; // Minimum bei Stripe Checkout

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }

  const event = findEvent(String(body.eventId ?? ""));
  const reg = event?.registration;
  if (!event || !reg) return json({ error: "Für dieses Event gibt es keine Anmeldung." }, 404);
  if (Date.now() >= registrationClosesAt(event).getTime())
    return json({ error: "Die Anmeldung für dieses Event ist geschlossen." }, 410);

  const name = String(body.name ?? "").trim().slice(0, 100);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  if (name.length < 2) return json({ error: "Bitte gib deinen Namen an." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Bitte gib eine gültige E-Mail-Adresse an." }, 400);
  if (body.acceptTerms !== true) return json({ error: "Bitte bestätige die Teilnahmebedingungen." }, 400);

  const store = ledgerStore();
  const first = reg.firstStartNumber ?? 1;
  const reservationId = `GT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const expiresAt = Date.now() + HOLD_MINUTES * 60_000;

  // 1) Platz reservieren (oder "ausgebucht" melden)
  try {
    await updateLedger(store, event.id, first, (ledger, now) =>
      reserveSeat(ledger, now, reg.capacity, reservationId, { name, email, expiresAt }),
    );
  } catch (err) {
    if (err instanceof SoldOutError) return json({ error: "Leider ausgebucht.", soldOut: true }, 409);
    if (err instanceof ConflictError) return json({ error: err.message }, 503);
    throw err;
  }

  // 2) Stripe-Checkout anlegen
  const base = siteUrl(req);
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      // Nur Karte inkl. Apple Pay / Google Pay – sofort bestätigt.
      // (SEPA-Lastschrift ist bewusst aus: Zahlung wäre erst nach Tagen sicher.)
      allowed_payment_method_types: ["card", "link"],
      customer_email: email,
      locale: "de",
      client_reference_id: reservationId,
      expires_at: Math.floor(expiresAt / 1000),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(reg.price * 100),
            product_data: {
              name: `Anmeldung: ${event.title}`,
              description: `${event.dateLabel}, ${event.time} · ${name}`,
            },
          },
        },
      ],
      metadata: { eventId: event.id, reservationId, name },
      payment_intent_data: {
        description: `${event.title} – ${name}`,
        metadata: { eventId: event.id, reservationId },
      },
      success_url: `${base}/events/danke?event=${encodeURIComponent(event.id)}&ref=${reservationId}`,
      cancel_url: `${base}/events?abgebrochen=${encodeURIComponent(event.id)}`,
    });
    return json({ url: session.url });
  } catch (err) {
    // Reservierung wieder freigeben, wenn Stripe nicht erreichbar ist
    await updateLedger(store, event.id, first, (ledger) => releaseSeat(ledger, reservationId)).catch(() => {});
    console.error("Stripe-Checkout fehlgeschlagen", err);
    return json({ error: "Bezahlung konnte nicht gestartet werden. Bitte später erneut versuchen." }, 502);
  }
};

export const config: Config = { path: "/api/checkout" };
