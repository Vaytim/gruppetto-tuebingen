// Verknüpft Stripe-Zahlungen, Erstattungen und Auszahlungen mit den Teilnehmern.
//
// Zahlung   → Teilnehmer bekommt chargeId, Gebühr, Netto
// Erstattung → Teilnehmer bekommt erstatteten Betrag (Platz wird bei voller Erstattung frei)
// Auszahlung → Teilnehmer bekommt payoutId + Datum; die Auszahlung wird pro Event
//              aufgeschlüsselt gespeichert (Grundlage für den Kassenbuch-Export)
import type Stripe from "stripe";
import type { GruppettoEvent } from "../../src/data/events";
import { registeredEvents } from "./event-store";
import {
  type EventLedger,
  type LedgerStore,
  type PayoutLine,
  type PayoutRecord,
  markPaidOut,
  markRefunded,
  payoutKey,
  readLedger,
  setPaymentDetails,
  updateJSON,
  updateLedger,
} from "./registrations";
import { stripe } from "./services";

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id);
const dateOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** Gebühr und Netto einer Zahlung bei Stripe nachschlagen. */
export async function fetchPaymentDetails(paymentIntentId: string) {
  const pi = await stripe().paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge = pi.latest_charge as Stripe.Charge | null;
  const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null;
  if (!charge || !bt) return null;
  return { chargeId: charge.id, fee: bt.fee, net: bt.net };
}

/** Nach erfolgreicher Zahlung: Gebühr/Netto beim Teilnehmer speichern. Fehler sind unkritisch (Abgleich holt nach). */
export async function recordPaymentDetails(store: LedgerStore, event: GruppettoEvent, reservationId: string, paymentIntentId?: string) {
  if (!paymentIntentId) return;
  try {
    const d = await fetchPaymentDetails(paymentIntentId);
    if (d) await updateLedger(store, event.id, event.registration?.firstStartNumber ?? 1, (l) => setPaymentDetails(l, reservationId, d));
  } catch (err) {
    console.warn("Gebühr konnte nicht abgerufen werden – wird beim nächsten Abgleich nachgeholt", err);
  }
}

/** Alle Event-Ledger laden und eine Zuordnung chargeId → eventId bauen. */
async function chargeIndex(store: LedgerStore) {
  const ledgers = new Map<string, EventLedger>();
  const byCharge = new Map<string, string>();
  for (const e of await registeredEvents(store)) {
    const l = await readLedger(store, e.id, e.registration.firstStartNumber);
    ledgers.set(e.id, l);
    for (const p of l.paid) if (p.chargeId) byCharge.set(p.chargeId, e.id);
  }
  return { ledgers, byCharge };
}

/** charge.refunded → Erstattung beim richtigen Teilnehmer vermerken. */
export async function handleRefund(store: LedgerStore, charge: Stripe.Charge): Promise<string | null> {
  const at = new Date().toISOString();
  for (const e of await registeredEvents(store)) {
    const ledger = await readLedger(store, e.id, e.registration.firstStartNumber);
    if (!ledger.paid.some((p) => p.chargeId === charge.id || idOf(charge.payment_intent) === p.paymentIntent)) continue;
    await updateLedger(store, e.id, e.registration.firstStartNumber ?? 1, (l) => {
      // Falls die Gebühr noch nicht abgeglichen war, chargeId über den PaymentIntent setzen
      const p = l.paid.find((x) => x.chargeId === charge.id || x.paymentIntent === idOf(charge.payment_intent));
      if (p && !p.chargeId) p.chargeId = charge.id;
      markRefunded(l, charge.id, charge.amount_refunded, at);
    });
    return e.id;
  }
  return null;
}

/** Eine Auszahlung bei Stripe aufschlüsseln, den Teilnehmern zuordnen und speichern. */
export async function syncPayout(store: LedgerStore, payout: Stripe.Payout): Promise<PayoutRecord> {
  const { byCharge } = await chargeIndex(store);
  const lines = new Map<string, PayoutLine>();
  const line = (eventId: string) => {
    let l = lines.get(eventId);
    if (!l) lines.set(eventId, (l = { eventId, payments: 0, gross: 0, fees: 0, refunds: 0, refundCount: 0, other: 0 }));
    return l;
  };
  const paidCharges = new Map<string, Set<string>>(); // eventId → chargeIds

  for await (const bt of stripe().balanceTransactions.list({ payout: payout.id, limit: 100, expand: ["data.source"] })) {
    if (bt.type === "payout") continue;
    const src = bt.source as unknown as { object?: string; id?: string; charge?: string | { id: string } } | null;
    if (bt.type === "charge" || bt.type === "payment") {
      const chargeId = src?.id ?? "";
      const eventId = byCharge.get(chargeId) ?? "sonstiges";
      const l = line(eventId);
      l.payments++;
      l.gross += bt.amount;
      l.fees += bt.fee;
      if (eventId !== "sonstiges") {
        if (!paidCharges.has(eventId)) paidCharges.set(eventId, new Set());
        paidCharges.get(eventId)!.add(chargeId);
      }
    } else if (bt.type === "refund" || bt.type === "payment_refund") {
      const chargeId = idOf(src?.charge) ?? "";
      const l = line(byCharge.get(chargeId) ?? "sonstiges");
      l.refundCount++;
      l.refunds += -bt.amount;
      l.fees += bt.fee;
    } else {
      line("sonstiges").other += bt.net;
    }
  }

  const arrivalDate = dateOf(payout.arrival_date);
  for (const [eventId, chargeIds] of paidCharges) {
    const e = (await registeredEvents(store)).find((x) => x.id === eventId);
    if (!e) continue;
    await updateLedger(store, eventId, e.registration.firstStartNumber ?? 1, (l) => markPaidOut(l, chargeIds, payout.id, arrivalDate));
  }

  const record: PayoutRecord = {
    id: payout.id,
    arrivalDate,
    amount: payout.amount,
    status: payout.status,
    lines: [...lines.values()],
    syncedAt: new Date().toISOString(),
  };
  await updateJSON<PayoutRecord | Record<string, never>, void>(store, payoutKey(payout.id), () => ({}), (doc) => {
    Object.assign(doc, record);
  });
  return record;
}

export async function listPayouts(store: LedgerStore): Promise<PayoutRecord[]> {
  const { blobs } = await store.list({ prefix: "payouts/" });
  const records = await Promise.all(
    blobs.map(async (b) => (await store.getWithMetadata(b.key, { type: "json" }))?.data as PayoutRecord | undefined),
  );
  return records.filter((r): r is PayoutRecord => !!r?.id).sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate));
}

/**
 * Abgleich auf Knopfdruck (Teilnehmerseite): holt fehlende Gebühren nach und
 * verarbeitet die letzten Auszahlungen – falls ein Webhook mal verloren ging.
 */
export async function syncRecent(store: LedgerStore) {
  let feesFilled = 0;
  for (const e of await registeredEvents(store)) {
    const ledger = await readLedger(store, e.id, e.registration.firstStartNumber);
    for (const p of ledger.paid.filter((x) => x.fee === undefined && x.paymentIntent).slice(0, 40)) {
      try {
        const d = await fetchPaymentDetails(p.paymentIntent!);
        if (d) {
          await updateLedger(store, e.id, e.registration.firstStartNumber ?? 1, (l) => setPaymentDetails(l, p.reservationId, d));
          feesFilled++;
        }
      } catch (err) {
        console.warn("Abgleich: Zahlung nicht gefunden", p.paymentIntent, err);
      }
    }
  }
  const known = new Map((await listPayouts(store)).map((p) => [p.id, p]));
  let payouts = 0;
  const recent = await stripe().payouts.list({ limit: 20 });
  for (const po of recent.data) {
    if (po.status !== "paid" && po.status !== "in_transit") continue;
    if (known.get(po.id)?.status === "paid") continue;
    await syncPayout(store, po);
    payouts++;
  }
  return { feesFilled, payouts };
}
