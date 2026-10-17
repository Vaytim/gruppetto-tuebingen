// NUR Dev-Server/StackBlitz: simuliert die Stripe-Bezahlseite.
// Liegt bewusst NICHT in netlify/functions → wird nie auf Netlify deployt.
import { findEvent } from "../src/data/events";
import { completeRegistration } from "../netlify/lib/complete-registration";
import { releaseSeat, updateLedger } from "../netlify/lib/registrations";
import { escapeHtml, ledgerStore } from "../netlify/lib/services";
import { isTestMode, testCheckouts } from "../netlify/lib/testmode";

const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } });

export default async (req: Request) => {
  if (!isTestMode()) return new Response("Nicht verfügbar", { status: 404 });
  const url = new URL(req.url);
  const id = url.searchParams.get("session") ?? "";
  const checkout = testCheckouts.get(id);
  if (!checkout) return new Response("Test-Bezahlung abgelaufen – bitte neu anmelden.", { status: 404 });
  const event = findEvent(checkout.eventId)!;

  if (req.method === "POST") {
    const action = (await req.formData()).get("action");
    testCheckouts.delete(id);
    if (action === "pay") {
      await completeRegistration(event, {
        reservationId: checkout.reservationId,
        checkoutSessionId: checkout.id,
        name: checkout.name,
        email: checkout.email,
        amountPaid: checkout.amount,
        paidAt: new Date().toISOString(),
        paymentIntent: `pi_test_${crypto.randomUUID().slice(0, 12)}`,
      });
      return redirect(checkout.successUrl);
    }
    await updateLedger(ledgerStore(), event.id, event.registration?.firstStartNumber ?? 1, (l) =>
      releaseSeat(l, checkout.reservationId),
    );
    return redirect(checkout.cancelUrl);
  }

  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test-Bezahlung</title>
<style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f6f8fa;color:#1a1f36}
  .banner{background:#ffb020;color:#3d2600;text-align:center;padding:.6rem 1rem;font-weight:600;font-size:.9rem}
  main{max-width:440px;margin:2.5rem auto;padding:0 16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);padding:1.75rem}
  .muted{color:#697386;font-size:.9rem;margin:0}.amount{font-size:2.2rem;font-weight:700;margin:.25rem 0 1.25rem}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;margin:0 0 1.5rem;font-size:.95rem}dt{color:#697386}dd{margin:0}
  .fake{border:1px solid #e3e8ee;border-radius:8px;padding:.8rem;font-family:monospace;color:#697386;margin-bottom:1.25rem}
  button{width:100%;padding:.85rem;border:0;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
  .pay{background:#635bff;color:#fff;margin-bottom:.6rem}.cancel{background:transparent;color:#697386}
</style>
<div class="banner">TESTMODUS – es wird kein echtes Geld bewegt</div>
<main><div class="card">
  <p class="muted">${escapeHtml(checkout.productName)}</p>
  <p class="amount">${euro(checkout.amount)}</p>
  <dl><dt>Name</dt><dd>${escapeHtml(checkout.name)}</dd><dt>E-Mail</dt><dd>${escapeHtml(checkout.email)}</dd>
  <dt>Datum</dt><dd>${escapeHtml(`${event.dateLabel}, ${event.time}`)}</dd><dt>Referenz</dt><dd>${escapeHtml(checkout.reservationId)}</dd></dl>
  <div class="fake">4242 4242 4242 4242 · 12/34 · 123</div>
  <form method="post">
    <button class="pay" name="action" value="pay">Testzahlung abschließen</button>
    <button class="cancel" name="action" value="cancel">Abbrechen und zurück</button>
  </form>
</div></main></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};
