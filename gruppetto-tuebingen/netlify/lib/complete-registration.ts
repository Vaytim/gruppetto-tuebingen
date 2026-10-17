// Nach erfolgreicher Zahlung: Startnummer vergeben + Bestätigungsmail.
// Wird vom echten Stripe-Webhook UND von der Test-Zahlung (StackBlitz) benutzt,
// damit der Test exakt denselben Ablauf prüft.
import type { GruppettoEvent } from "../../src/data/events";
import { confirmationMail } from "./confirmation-mail";
import { confirmPayment, markMailSent, updateLedger, type Participant } from "./registrations";
import { ledgerStore, sendMail } from "./services";

export class MailFailedError extends Error {
  constructor(public participant: Participant, cause: unknown) {
    super("Mailversand fehlgeschlagen", { cause });
  }
}

export async function completeRegistration(
  event: GruppettoEvent,
  data: Omit<Participant, "startNumber" | "mailSent">,
): Promise<Participant> {
  const store = ledgerStore();
  const first = event.registration?.firstStartNumber ?? 1;

  // Idempotent – doppelte Webhooks vergeben keine zweite Nummer
  const participant = await updateLedger(store, event.id, first, (ledger) => confirmPayment(ledger, data));

  if (!participant.mailSent) {
    const mail = confirmationMail(event, participant);
    try {
      await sendMail({ to: participant.email, ref: participant.reservationId, ...mail });
    } catch (err) {
      throw new MailFailedError(participant, err);
    }
    await updateLedger(store, event.id, first, (ledger) => markMailSent(ledger, data.reservationId));
    participant.mailSent = true;
  }
  return participant;
}
