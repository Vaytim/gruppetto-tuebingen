// POST /api/stripe-webhook – wird von Stripe aufgerufen.
//  checkout.session.completed → Startnummer vergeben + Bestätigungsmail
//  checkout.session.expired   → reservierten Platz wieder freigeben
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import { findEvent } from "../../src/data/events";
import { completeRegistration, MailFailedError } from "../lib/complete-registration";
import { releaseSeat, updateLedger } from "../lib/registrations";
import { env, json, ledgerStore, stripe } from "../lib/services";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  let evt: Stripe.Event;
  try {
    const signature = req.headers.get("stripe-signature") ?? "";
    evt = await stripe().webhooks.constructEventAsync(await req.text(), signature, env("STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    console.warn("Ungültige Webhook-Signatur", err);
    return json({ error: "Ungültige Signatur" }, 400);
  }

  if (evt.type !== "checkout.session.completed" && evt.type !== "checkout.session.expired") {
    return json({ ignored: evt.type });
  }

  const session = evt.data.object as Stripe.Checkout.Session;
  const eventId = session.metadata?.eventId ?? "";
  const reservationId = session.metadata?.reservationId ?? session.client_reference_id ?? "";
  const event = findEvent(eventId);
  if (!event?.registration || !reservationId) {
    console.warn("Webhook für unbekanntes Event", eventId, reservationId);
    return json({ ignored: "unbekanntes Event" });
  }
  const store = ledgerStore();
  const first = event.registration.firstStartNumber ?? 1;

  if (evt.type === "checkout.session.expired") {
    await updateLedger(store, eventId, first, (ledger) => releaseSeat(ledger, reservationId));
    return json({ released: reservationId });
  }

  if (session.payment_status !== "paid") return json({ waiting: session.payment_status });

  try {
    const participant = await completeRegistration(event, {
      reservationId,
      checkoutSessionId: session.id,
      name: session.metadata?.name ?? session.customer_details?.name ?? "",
      email: session.customer_details?.email ?? session.customer_email ?? "",
      amountPaid: session.amount_total ?? 0,
      paidAt: new Date(evt.created * 1000).toISOString(),
      paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
    });
    return json({ ok: true, startNumber: participant.startNumber });
  } catch (err) {
    if (!(err instanceof MailFailedError)) throw err;
    // 500 → Stripe wiederholt den Webhook später, die Startnummer bleibt dieselbe.
    console.error(`Mailversand an ${err.participant.email} fehlgeschlagen – Stripe versucht es erneut`, err.cause);
    return json({ error: "Mailversand fehlgeschlagen", startNumber: err.participant.startNumber }, 500);
  }
};

export const config: Config = { path: "/api/stripe-webhook" };
