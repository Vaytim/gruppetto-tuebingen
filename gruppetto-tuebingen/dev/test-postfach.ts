// NUR Dev-Server/StackBlitz: zeigt die Mails, die im Testmodus "verschickt" wurden.
//   /api/test-postfach          → alle Mails
//   /api/test-postfach?ref=GT-… → nur die Mail zu einer Anmeldung
import { escapeHtml } from "../netlify/lib/services";
import { isTestMode, testOutbox } from "../netlify/lib/testmode";

export default async (req: Request) => {
  if (!isTestMode()) return new Response("Nicht verfügbar", { status: 404 });
  const ref = new URL(req.url).searchParams.get("ref");
  const mails = ref ? testOutbox.filter((m) => m.ref === ref) : testOutbox;

  const items = mails
    .map(
      (m) => `<section>
  <dl><dt>An</dt><dd>${escapeHtml(m.to)}</dd><dt>Betreff</dt><dd><strong>${escapeHtml(m.subject)}</strong></dd>
  <dt>Gesendet</dt><dd>${new Date(m.sentAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</dd></dl>
  <iframe sandbox srcdoc="${escapeHtml(m.html)}" title="Mail-Vorschau"></iframe>
</section>`,
    )
    .join("");

  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test-Postfach</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0f1210;color:#f2f4f1}
  .banner{background:#ffb020;color:#3d2600;text-align:center;padding:.6rem 1rem;font-weight:600;font-size:.9rem}
  main{max-width:680px;margin:2rem auto;padding:0 16px}a{color:#d7f542}
  section{background:#1a1f1b;border-radius:14px;padding:1rem;margin-bottom:1.5rem}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.3rem 1rem;margin:0 0 1rem;font-size:.95rem}dt{color:#a9b0aa}dd{margin:0}
  iframe{width:100%;height:640px;border:0;border-radius:10px;background:#f2f4f1}
</style>
<div class="banner">TESTMODUS – diese Mails wurden nicht wirklich verschickt</div>
<main>
  <h1>Test-Postfach</h1>
  ${items || "<p>Noch keine Mails. Melde dich auf <a href=\"/events\">/events</a> an und schließ die Testzahlung ab.</p>"}
  <p><a href="/events">← Zu den Events</a>${ref ? ' · <a href="/api/test-postfach">Alle Mails</a>' : ""}</p>
</main></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};
