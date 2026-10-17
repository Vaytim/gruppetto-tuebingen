// Testmodus (StackBlitz): ahmt Stripe-Gebühren und eine Auszahlung nach,
// damit Verwaltungsseite und Kassenbuch-Export ohne Stripe ausprobiert werden können.
// Wird nur aufgerufen, wenn isTestMode() aktiv ist.
import { events } from "../../src/data/events";
import {
  type LedgerStore,
  type PayoutLine,
  type PayoutRecord,
  isActive,
  markPaidOut,
  payoutKey,
  readLedger,
  setPaymentDetails,
  updateJSON,
  updateLedger,
} from "./registrations";

/** Stripe-Standardgebühr für EWR-Karten: 1,5 % + 0,25 € (nur zur Simulation). */
export const testFee = (amount: number) => Math.round(amount * 0.015) + 25;

/** Gebühr/Netto für eine Test-Zahlung speichern, als wäre es Stripe. */
export async function recordTestPaymentDetails(store: LedgerStore, eventId: string, firstStartNumber: number, reservationId: string, amount: number) {
  const fee = testFee(amount);
  const chargeId = `ch_test_${reservationId}`;
  await updateLedger(store, eventId, firstStartNumber, (l) => setPaymentDetails(l, reservationId, { chargeId, fee, net: amount - fee }));
}

/**
 * "Mit Stripe abgleichen" im Testmodus: Alle bezahlten, noch nicht ausgezahlten
 * Anmeldungen werden in EINE simulierte Auszahlung von heute gepackt.
 */
export async function simulateTestPayout(store: LedgerStore) {
  const id = `po_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const arrivalDate = new Date().toISOString().slice(0, 10);
  const lines: PayoutLine[] = [];

  for (const e of events.filter((x) => x.registration)) {
    const first = e.registration!.firstStartNumber ?? 1;
    const ledger = await readLedger(store, e.id, first);
    const open = ledger.paid.filter((p) => !p.payoutId && p.chargeId && isActive(p));
    if (!open.length) continue;
    lines.push({
      eventId: e.id,
      payments: open.length,
      gross: open.reduce((s, p) => s + p.amountPaid, 0),
      fees: open.reduce((s, p) => s + (p.fee ?? 0), 0),
      refunds: 0,
      refundCount: 0,
      other: 0,
    });
    await updateLedger(store, e.id, first, (l) => markPaidOut(l, new Set(open.map((p) => p.chargeId!)), id, arrivalDate));
  }

  if (!lines.length) return { payouts: 0, amount: 0 };
  const amount = lines.reduce((s, l) => s + l.gross - l.fees, 0);
  const record: PayoutRecord = { id, arrivalDate, amount, status: "paid", lines, syncedAt: new Date().toISOString() };
  await updateJSON<PayoutRecord | Record<string, never>, void>(store, payoutKey(id), () => ({}), (doc) => {
    Object.assign(doc, record);
  });
  return { payouts: 1, amount };
}
