// POST /api/stripe-webhook – wird von Stripe aufgerufen.
//  checkout.session.completed → Startnummer vergeben + Bestätigungsmail
//  checkout.session.expired   → reservierten Platz wieder freigeben
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import { findEvent } from "../../src/data/events";
import { confirmationMail } from "../lib/confirmation-mail";
import { confirmPayment, markMailSent, releaseSeat, updateLedger } from "../lib/registrations";
import { env, json, ledgerStore, mailer, stripe } from "../lib/services";

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

  // Startnummer vergeben (idempotent – doppelte Webhooks vergeben keine zweite Nummer)
  const participant = await updateLedger(store, eventId, first, (ledger) =>
    confirmPayment(ledger, {
      reservationId,
      checkoutSessionId: session.id,
      name: session.metadata?.name ?? session.customer_details?.name ?? "",
      email: session.customer_details?.email ?? session.customer_email ?? "",
      amountPaid: session.amount_total ?? 0,
      paidAt: new Date(evt.created * 1000).toISOString(),
      paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
    }),
  );

  if (!participant.mailSent) {
    const mail = confirmationMail(event, participant);
    // Schlägt der Versand fehl, antworten wir mit 500 → Stripe wiederholt den
    // Webhook später, die Startnummer bleibt dabei dieselbe.
    try {
      await mailer().sendMail({
        from: env("MAIL_FROM"),
        replyTo: process.env.MAIL_REPLY_TO || undefined,
        bcc: process.env.MAIL_BCC || undefined,
        to: participant.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (err) {
      console.error(`Mailversand an ${participant.email} fehlgeschlagen – Stripe versucht es erneut`, err);
      return json({ error: "Mailversand fehlgeschlagen", startNumber: participant.startNumber }, 500);
    }
    await updateLedger(store, eventId, first, (ledger) => markMailSent(ledger, reservationId));
  }

  return json({ ok: true, startNumber: participant.startNumber });
};

export const config: Config = { path: "/api/stripe-webhook" };
