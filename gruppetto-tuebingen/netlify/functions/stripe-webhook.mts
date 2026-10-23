// POST /api/stripe-webhook – wird von Stripe aufgerufen.
//  checkout.session.completed → Startnummer vergeben, Gebühr speichern, Bestätigungsmail
//  checkout.session.expired   → reservierten Platz wieder freigeben
//  charge.refunded            → Erstattung beim Teilnehmer vermerken
//  payout.paid / payout.failed → Auszahlung aufschlüsseln und Teilnehmern zuordnen
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import { findLiveEvent } from "../lib/event-store";
import { handleRefund, recordPaymentDetails, syncPayout } from "../lib/accounting";
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

  const store = ledgerStore();

  switch (evt.type) {
    case "checkout.session.completed":
    case "checkout.session.expired":
      return handleCheckout(evt, store);
    case "charge.refunded": {
      const eventId = await handleRefund(store, evt.data.object as Stripe.Charge);
      return json({ refunded: eventId ?? "nicht zugeordnet" });
    }
    case "payout.paid":
    case "payout.failed": {
      const record = await syncPayout(store, evt.data.object as Stripe.Payout);
      return json({ payout: record.id, lines: record.lines.length });
    }
    default:
      return json({ ignored: evt.type });
  }
};

async function handleCheckout(evt: Stripe.Event, store: ReturnType<typeof ledgerStore>) {
  const session = evt.data.object as Stripe.Checkout.Session;
  const eventId = session.metadata?.eventId ?? "";
  const reservationId = session.metadata?.reservationId ?? session.client_reference_id ?? "";
  const event = await findLiveEvent(store, eventId);
  if (!event?.registration || !reservationId) {
    console.warn("Webhook für unbekanntes Event", eventId, reservationId);
    return json({ ignored: "unbekanntes Event" });
  }
  const first = event.registration.firstStartNumber ?? 1;

  if (evt.type === "checkout.session.expired") {
    await updateLedger(store, eventId, first, (ledger) => releaseSeat(ledger, reservationId));
    return json({ released: reservationId });
  }

  if (session.payment_status !== "paid") return json({ waiting: session.payment_status });

  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  // Startnummer vergeben (idempotent), Gebühr speichern, Bestätigungsmail
  try {
    const participant = await completeRegistration(
      event,
      {
        reservationId,
        checkoutSessionId: session.id,
        name: session.metadata?.name ?? session.customer_details?.name ?? "",
        email: session.customer_details?.email ?? session.customer_email ?? "",
        amountPaid: session.amount_total ?? 0,
        paidAt: new Date(evt.created * 1000).toISOString(),
        paymentIntent,
      },
      // Gebühr + Netto für die Buchhaltung (nicht kritisch, Abgleich holt nach)
      (p) => (p.fee === undefined ? recordPaymentDetails(store, event, reservationId, paymentIntent) : undefined),
    );
    return json({ ok: true, startNumber: participant.startNumber });
  } catch (err) {
    if (!(err instanceof MailFailedError)) throw err;
    // 500 → Stripe wiederholt den Webhook später, die Startnummer bleibt dieselbe.
    console.error(`Mailversand an ${err.participant.email} fehlgeschlagen – Stripe versucht es erneut`, err.cause);
    return json({ error: "Mailversand fehlgeschlagen", startNumber: err.participant.startNumber }, 500);
  }
}

export const config: Config = { path: "/api/stripe-webhook" };
