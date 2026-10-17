// Speichert pro Event ein JSON-Dokument in Netlify Blobs:
//   { pending: { [reservationId]: Reservierung }, paid: [Teilnehmer], nextStartNumber }
// Jede Änderung läuft über ein bedingtes Schreiben (ETag). Melden sich zwei
// Leute gleichzeitig an, gewinnt einer, der andere liest neu und versucht es
// erneut – so gibt es weder doppelte Startnummern noch Überbuchung.

export interface Reservation {
  name: string;
  email: string;
  expiresAt: number; // ms seit Epoch
}

export interface Participant {
  reservationId: string;
  checkoutSessionId: string;
  startNumber: number;
  name: string;
  email: string;
  amountPaid: number; // in Cent
  paidAt: string; // ISO
  paymentIntent?: string;
  mailSent: boolean;
  // --- Zahlungsdetails aus Stripe (für die Buchhaltung) ---
  chargeId?: string;
  /** Stripe-Gebühr in Cent */
  fee?: number;
  /** Gutgeschrieben nach Gebühr, in Cent */
  net?: number;
  /** Erstatteter Betrag in Cent (0 = keine Erstattung) */
  refunded?: number;
  refundedAt?: string;
  /** Auszahlung, mit der die Zahlung aufs Vereinskonto kam */
  payoutId?: string;
  payoutDate?: string; // YYYY-MM-DD
}

/** Teilnahme zählt, solange nicht voll erstattet. */
export function isActive(p: Participant): boolean {
  return (p.refunded ?? 0) < p.amountPaid;
}

export interface EventLedger {
  pending: Record<string, Reservation>;
  paid: Participant[];
  nextStartNumber: number;
}

/** Minimale Schnittstelle, die Netlify Blobs erfüllt (und ein Test-Speicher). */
export interface LedgerStore {
  getWithMetadata(
    key: string,
    opts: { type: "json" },
  ): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(
    key: string,
    value: unknown,
    opts?: { onlyIfMatch?: string } | { onlyIfNew?: boolean },
  ): Promise<{ modified: boolean; etag?: string }>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

export class ConflictError extends Error {}

function emptyLedger(firstStartNumber: number): EventLedger {
  return { pending: {}, paid: [], nextStartNumber: firstStartNumber };
}

function dropExpired(ledger: EventLedger, now: number) {
  for (const [id, r] of Object.entries(ledger.pending)) {
    if (r.expiresAt <= now) delete ledger.pending[id];
  }
}

export function seatsTaken(ledger: EventLedger, now = Date.now()): number {
  const pending = Object.values(ledger.pending).filter((r) => r.expiresAt > now).length;
  return ledger.paid.filter(isActive).length + pending;
}

export async function readLedger(
  store: LedgerStore,
  eventId: string,
  firstStartNumber = 1,
): Promise<EventLedger> {
  const entry = await store.getWithMetadata(eventId, { type: "json" });
  return (entry?.data as EventLedger | undefined) ?? emptyLedger(firstStartNumber);
}

/**
 * Liest das Dokument, wendet `change` an und schreibt bedingt zurück.
 * `change` darf Fehler werfen (z. B. "ausgebucht"), dann wird nichts geschrieben.
 */
export function updateLedger<T>(
  store: LedgerStore,
  eventId: string,
  firstStartNumber: number,
  change: (ledger: EventLedger, now: number) => T,
): Promise<T> {
  return updateJSON<EventLedger, T>(store, eventId, () => emptyLedger(firstStartNumber), (ledger, now) => {
    dropExpired(ledger, now);
    return change(ledger, now);
  });
}

/** Allgemeines "lesen → ändern → bedingt schreiben" für ein JSON-Dokument. */
export async function updateJSON<D, T>(
  store: LedgerStore,
  key: string,
  init: () => D,
  change: (doc: D, now: number) => T,
  maxMillis = 7000, // unter Netlifys 10-Sekunden-Limit für Functions bleiben
): Promise<T> {
  const started = Date.now();
  for (let attempt = 0; Date.now() - started < maxMillis; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "json" });
    const doc: D = structuredClone((entry?.data as D | undefined) ?? init());
    const result = change(doc, Date.now());

    const write = entry?.etag
      ? await store.setJSON(key, doc, { onlyIfMatch: entry.etag })
      : await store.setJSON(key, doc, { onlyIfNew: true });
    if (write.modified) return result;

    // Jemand anderes war schneller – kurz (zufällig, wachsend) warten und neu versuchen.
    const backoff = Math.min(400, 20 * 1.5 ** attempt);
    await new Promise((r) => setTimeout(r, backoff / 2 + Math.random() * backoff));
  }
  throw new ConflictError("Zu viele gleichzeitige Anmeldungen, bitte erneut versuchen.");
}

export class SoldOutError extends Error {}

/** Reserviert einen Platz für die Dauer des Bezahlvorgangs. */
export function reserveSeat(
  ledger: EventLedger,
  now: number,
  capacity: number,
  reservationId: string,
  reservation: Reservation,
) {
  if (seatsTaken(ledger, now) >= capacity) throw new SoldOutError("Ausgebucht");
  ledger.pending[reservationId] = reservation;
}

/**
 * Bestätigt eine bezahlte Anmeldung und vergibt die nächste Startnummer.
 * Idempotent: Kommt derselbe Stripe-Webhook doppelt, wird nichts doppelt vergeben.
 */
export function confirmPayment(
  ledger: EventLedger,
  data: Omit<Participant, "startNumber" | "mailSent">,
): Participant {
  const existing = ledger.paid.find((p) => p.reservationId === data.reservationId);
  if (existing) return existing;
  delete ledger.pending[data.reservationId];
  const participant: Participant = {
    ...data,
    startNumber: ledger.nextStartNumber,
    mailSent: false,
  };
  ledger.nextStartNumber += 1;
  ledger.paid.push(participant);
  return participant;
}

export function markMailSent(ledger: EventLedger, reservationId: string) {
  const p = ledger.paid.find((x) => x.reservationId === reservationId);
  if (p) p.mailSent = true;
}

export function releaseSeat(ledger: EventLedger, reservationId: string) {
  delete ledger.pending[reservationId];
}

export function findByCharge(ledger: EventLedger, chargeId: string): Participant | undefined {
  return ledger.paid.find((p) => p.chargeId === chargeId);
}

export function setPaymentDetails(
  ledger: EventLedger,
  reservationId: string,
  d: { chargeId: string; fee: number; net: number },
) {
  const p = ledger.paid.find((x) => x.reservationId === reservationId);
  if (p) Object.assign(p, d);
}

/** Erstattung vermerken. Bei voller Erstattung wird der Platz wieder frei (Startnummer bleibt vergeben). */
export function markRefunded(ledger: EventLedger, chargeId: string, refunded: number, at: string): boolean {
  const p = findByCharge(ledger, chargeId);
  if (!p) return false;
  if ((p.refunded ?? 0) !== refunded) {
    p.refunded = refunded;
    p.refundedAt = at;
  }
  return true;
}

export function markPaidOut(ledger: EventLedger, chargeIds: Set<string>, payoutId: string, payoutDate: string): number {
  let n = 0;
  for (const p of ledger.paid) {
    if (p.chargeId && chargeIds.has(p.chargeId)) {
      p.payoutId = payoutId;
      p.payoutDate = payoutDate;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Auszahlungen (eine Stripe-Überweisung aufs Vereinskonto)

export interface PayoutLine {
  eventId: string; // "sonstiges" für nicht zuordenbare Posten
  /** Anzahl bezahlter Anmeldungen in dieser Auszahlung */
  payments: number;
  gross: number; // Cent
  fees: number; // Cent (positiv = Ausgabe)
  refunds: number; // Cent (positiv = zurückgezahlt)
  refundCount: number;
  other: number; // Cent, sonstige Posten (z. B. Stripe-Korrekturen), vorzeichenbehaftet
}

export interface PayoutRecord {
  id: string;
  arrivalDate: string; // YYYY-MM-DD
  amount: number; // Cent, Betrag auf dem Kontoauszug
  status: string;
  lines: PayoutLine[];
  syncedAt: string;
}

export const payoutKey = (id: string) => `payouts/${id}`;
