# Event-Anmeldung mit Stripe – Einrichtung

So funktioniert's: Anmeldeformular auf `/events` → Platz wird 30 Min. reserviert → Bezahlung bei Stripe → Stripe meldet die Zahlung an `/api/stripe-webhook` → Startnummer wird vergeben und per Mail verschickt → Danke-Seite zeigt die Startnummer.

## Was wo liegt

| Datei | Zweck |
|---|---|
| `src/data/events.ts` | **Alle Events.** Für Anmeldung `registration: { price: 20, capacity: 100 }` ergänzen |
| `src/pages/events.astro` | Event-Karten, Anmelde-Button, Formular |
| `src/pages/events/danke.astro` | Danke-Seite mit Startnummer |
| `netlify/functions/checkout.mts` | Platz reservieren, Stripe-Bezahlung starten |
| `netlify/functions/stripe-webhook.mts` | Zahlung bestätigen, Startnummer, Mail |
| `netlify/functions/event-status.mts` | Freie Plätze für die Website |
| `netlify/functions/teilnehmer.mts` | Verwaltung: Teilnehmer + Zahlungen, Kassenbuch-Export (passwortgeschützt) |
| `netlify/lib/accounting.ts` | Verknüpft Stripe-Zahlungen, Erstattungen und Auszahlungen mit den Teilnehmern |
| `netlify/lib/confirmation-mail.ts` | Text und Design der Bestätigungsmail |

Gespeichert wird in **Netlify Blobs** (in eurer Netlify-Site enthalten, nichts extra einzurichten).

## Testen in StackBlitz (ohne Netlify, ohne Stripe)

`npm run dev` startet automatisch den **Testmodus**, solange kein `STRIPE_SECRET_KEY` gesetzt ist:

1. `/events` → bei einem Event mit offener Anmeldung auf „Anmelden" → Formular ausfüllen.
2. Statt Stripe kommt eine orange markierte **Test-Bezahlseite** → „Testzahlung abschließen" (oder „Abbrechen" zum Testen des Abbruchs).
3. **Danke-Seite** mit Startnummer → Button „Testmodus: Bestätigungsmail ansehen".
4. Alle Test-Mails: `/api/test-postfach` · Teilnehmerliste: `/api/teilnehmer` (Passwort `test`).
5. In der Verwaltung simuliert „🧪 Test-Auszahlung simulieren" eine Stripe-Auszahlung (Gebühr 1,5 % + 0,25 €), damit ihr Übersicht, Auszahlungen und Kassenbuch-CSV ausprobieren könnt. Erstattungen lassen sich im Testmodus nicht simulieren.

Die Testdaten liegen nur im Arbeitsspeicher; ein Neustart des Dev-Servers setzt alles zurück. Die Test-Seiten (`dev/`) werden nie auf Netlify deployt.

## Einmalige Einrichtung

### 1. Stripe-Konto
1. Auf stripe.com ein Konto für den Verein anlegen (Rechtsform: Verein), Vereinskonto als Auszahlungskonto hinterlegen.
2. Erst im **Testmodus** arbeiten: Entwickler → API-Schlüssel → **Geheimer Schlüssel** (`sk_test_…`) kopieren.
3. Entwickler → Webhooks → **Endpunkt hinzufügen**
   - URL: `https://gruppetto-tuebingen.de/api/stripe-webhook`
   - Ereignisse: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `payout.paid`, `payout.failed`
   - Danach das **Signaturgeheimnis** (`whsec_…`) kopieren.
4. Einstellungen → Auszahlungen: **automatisch, wöchentlich** (z. B. montags). Wichtig: Nur automatische Auszahlungen lassen sich den Teilnehmern zuordnen.
5. Optional: Einstellungen → Kunden-E-Mails → „Erfolgreiche Zahlungen" aktivieren, dann schickt Stripe zusätzlich eine offizielle Quittung.

### 2. Absender-Postfach
Ein Postfach bei eurem Domain-Hoster anlegen, z. B. `anmeldung@gruppetto-tuebingen.de`, und die SMTP-Daten notieren (Server, Port, Benutzer, Passwort). Steht meist in der Hilfe des Hosters unter „E-Mail-Programm einrichten".

### 3. Umgebungsvariablen in Netlify
Netlify → Site → **Site configuration → Environment variables** – alle Werte aus `.env.example` eintragen:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `ADMIN_PASSWORD` (optional `MAIL_REPLY_TO`, `MAIL_BCC`).
Danach einmal neu deployen.

### 4. Testen
1. Test-Event in `src/data/events.ts` mit Datum in der Zukunft anlegen, pushen.
2. Auf `/events` anmelden, bei Stripe mit Testkarte `4242 4242 4242 4242`, beliebiges Datum in der Zukunft, beliebige CVC bezahlen.
3. Prüfen: Danke-Seite zeigt Startnummer, Mail kommt an, `/api/teilnehmer` zeigt die Anmeldung.
4. Klappt alles: in Stripe auf **Live** umschalten, Live-Schlüssel + neuen Live-Webhook (`whsec_…`) in Netlify eintragen, neu deployen.

## Im Alltag

- **Neues Event:** in `src/data/events.ts` eintragen, `id` eindeutig wählen und später **nicht mehr ändern**.
- **Anmeldegebühr pro Event:** im jeweiligen Event `registration: { price: 15, capacity: 60 }` setzen – jedes Event hat seinen eigenen Preis (Cent-Beträge wie `12.5` gehen, Minimum 0,50 €). Preisänderung = Datei ändern + pushen; gilt für alle neuen Anmeldungen, bereits Bezahlte behalten ihren Betrag. Ein Tippfehler (z. B. Preis 0) lässt den Build absichtlich fehlschlagen.
- **Verwaltung:** `https://gruppetto-tuebingen.de/api/teilnehmer` öffnen → Passwort = `ADMIN_PASSWORD` (Benutzername egal).
  - Übersicht: Brutto, Gebühren, Erstattungen, Netto, was schon aufs Konto überwiesen wurde, und jede Stripe-Auszahlung mit Aufschlüsselung pro Event (Abgleich „stimmt").
  - Pro Event: jede:r Teilnehmer:in mit Startnummer, Zahlung, Gebühr, Netto, Status (bezahlt/erstattet) und mit welcher Auszahlung das Geld aufs Konto kam. Als CSV herunterladbar.
  - **Kassenbuch-CSV** pro Jahr: je Auszahlung die Zeilen Einnahmen (brutto), Erstattungen und Stripe-Gebühren mit Belegnummer `ST-Datum-…` – die Summe entspricht dem Betrag auf dem Kontoauszug.
  - „Mit Stripe abgleichen" holt fehlende Gebühren/Auszahlungen nach, falls ein Webhook mal nicht ankam.
- **Off-Season:** In der Verwaltung unter „Website“ → „Off-Season aktivieren“. Die Rides-Seite zeigt dann „season closed.“ mit Animation über den Weekly Rides – sofort, ohne neuen Deploy. Gleicher Knopf zum Beenden.
- **Storno/Erstattung:** im Stripe-Dashboard bei der Zahlung „Erstatten". Bei voller Erstattung wird der Platz automatisch wieder frei (die Startnummer wird nicht neu vergeben).
- **Anmeldeschluss:** standardmäßig um 0:00 Uhr am Event-Tag, anpassbar per `registration.closesAt: "2027-05-06T23:59"`.
- **Buchhaltung:** Kassenbuch-CSV aus der Verwaltung übernehmen; als Beleg je Auszahlung zusätzlich den Auszahlungsbericht aus dem Stripe-Dashboard (Auszahlungen → Auszahlung → Exportieren) mit derselben Belegnummer ablegen. Die monatliche Gebührenübersicht findet ihr in Stripe unter Dokumente.

## Noch zu erledigen (rechtlich)
- `/rechtliches`: Teilnahmebedingungen (Haftung, Storno) und Datenschutzhinweise für die Anmeldung ergänzen (Name, E-Mail, Zahlungsabwicklung durch Stripe, Speicherung bei Netlify, Löschfrist).
- Auftragsverarbeitungsverträge (AVV) mit Netlify und Stripe abschließen (beide bieten das online an).
