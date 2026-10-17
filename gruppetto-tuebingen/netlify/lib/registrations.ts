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
  return ledger.paid.length + pending;
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
export async function updateLedger<T>(
  store: LedgerStore,
  eventId: string,
  firstStartNumber: number,
  change: (ledger: EventLedger, now: number) => T,
  maxMillis = 7000, // unter Netlifys 10-Sekunden-Limit für Functions bleiben
): Promise<T> {
  const started = Date.now();
  for (let attempt = 0; Date.now() - started < maxMillis; attempt++) {
    const entry = await store.getWithMetadata(eventId, { type: "json" });
    const ledger: EventLedger = structuredClone(
      (entry?.data as EventLedger | undefined) ?? emptyLedger(firstStartNumber),
    );
    const now = Date.now();
    dropExpired(ledger, now);
    const result = change(ledger, now);

    const write = entry?.etag
      ? await store.setJSON(eventId, ledger, { onlyIfMatch: entry.etag })
      : await store.setJSON(eventId, ledger, { onlyIfNew: true });
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
