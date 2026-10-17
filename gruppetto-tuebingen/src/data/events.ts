// Zentrale Event-Liste – wird von der Events-Seite UND vom Anmelde-Backend
// (netlify/functions) gelesen. Preis und Plätze kommen nur von hier, das
// Formular im Browser kann sie also nicht manipulieren.

export interface Registration {
  /** Teilnahmegebühr in Euro für DIESES Event, z. B. 20 oder 12.5 (mind. 0.50 – Stripe-Minimum) */
  price: number;
  /** Maximale Teilnehmerzahl */
  capacity: number;
  /** Erste vergebene Startnummer (Standard: 1) */
  firstStartNumber?: number;
  /** Anmeldeschluss als ISO-Datum/Zeit, z. B. "2026-09-25T23:59". Standard: Event-Tag 00:00 */
  closesAt?: string;
}

export interface GruppettoEvent {
  /** Eindeutige, dauerhafte ID – NICHT mehr ändern, sobald Anmeldungen laufen */
  id: string;
  title: string;
  dateISO: string;
  dateLabel: string;
  time: string;
  location: string;
  level: string;
  description: string;
  image: string;
  /** Weglassen = Event ohne Anmeldung (wird nur angezeigt) */
  registration?: Registration;
}

export const events: GruppettoEvent[] = [
  {
    id: "2026-grillfahrt-neckar",
    title: "Sommer-Grillfahrt an den Neckar",
    dateISO: "2026-08-15",
    dateLabel: "15. August 2026",
    time: "17:30 Uhr",
    location: "Treffpunkt: Neckarbrücke Tübingen",
    level: "Locker · alle Levels",
    description:
      "Entspannte Ausfahrt entlang des Neckars mit anschließendem Grillen am Fluss. Bringt gute Laune und etwas für den Grill mit - Getränke sind organisiert.",
    image: "https://picsum.photos/seed/gruppetto-grill/640/420",
  },
  {
    id: "2026-nachtfahrt",
    title: "Nachtfahrt mit Lichterkette",
    dateISO: "2026-08-29",
    dateLabel: "29. August 2026",
    time: "20:30 Uhr",
    location: "Treffpunkt: Finanzamt Tübingen",
    level: "Mittel · Beleuchtung Pflicht",
    description:
      "Wenn es dunkel wird, drehen wir eine ruhige Runde durchs Umland - mit Lichtern an den Rädern und guter Stimmung. Helm und Licht sind Pflicht.",
    image: "https://picsum.photos/seed/gruppetto-night/640/420",
  },
  {
    id: "2026-rookie-workshop",
    title: "Rookie-Workshop: Erste Gruppenfahrt",
    dateISO: "2026-09-12",
    dateLabel: "12. September 2026",
    time: "10:00 Uhr",
    location: "Treffpunkt: Technisches Rathaus",
    level: "Einsteiger · geführt",
    description:
      "Für alle, die noch nie in der Gruppe gefahren sind: Wir erklären Handzeichen, Windschattenfahren und Verhalten im Verkehr, bevor es auf eine kurze Übungsrunde geht.",
    image: "https://picsum.photos/seed/gruppetto-rookie/640/420",
  },
  {
    id: "2026-alb-ausflug",
    title: "Gruppetto-Vereinsausflug: Schwäbische Alb",
    dateISO: "2026-09-27",
    dateLabel: "27. September 2026",
    time: "08:00 Uhr",
    location: "Treffpunkt: Bahnhof Tübingen",
    level: "Anspruchsvoll · Höhenmeter",
    description:
      "Ein ganzer Tag auf der Alb mit ordentlich Höhenmetern, tollen Ausblicken und einer wohlverdienten Einkehr zum Abschluss. Verpflegung für unterwegs nicht vergessen!",
    image: "https://picsum.photos/seed/gruppetto-alb/640/420",
    registration: { price: 20, capacity: 100 },
  },
  {
    id: "2026-saisonabschluss",
    title: "Herbst-Ausfahrt & Saisonabschluss",
    dateISO: "2026-10-17",
    dateLabel: "17. Oktober 2026",
    time: "13:00 Uhr",
    location: "Treffpunkt: Finanzamt Tübingen",
    level: "Locker · alle Levels",
    description:
      "Wir lassen die Saison gemeinsam ausklingen: eine entspannte Fahrt durchs bunte Herbstlaub, danach Punsch und Rückblick auf ein tolles Jahr.",
    image: "https://picsum.photos/seed/gruppetto-herbst/640/420",
    registration: { price: 20, capacity: 100, closesAt: "2026-10-17T23:59" },
  },
];

// Sicherheitsnetz: falsche Preise/Plätze lassen den Build fehlschlagen,
// statt erst bei der ersten Anmeldung aufzufallen.
for (const e of events) {
  const r = e.registration;
  if (!r) continue;
  if (!Number.isFinite(r.price) || r.price < 0.5 || Math.round(r.price * 100) !== r.price * 100)
    throw new Error(`Event "${e.id}": price muss mind. 0.50 € sein und max. 2 Nachkommastellen haben (z. B. 12.5).`);
  if (!Number.isInteger(r.capacity) || r.capacity < 1)
    throw new Error(`Event "${e.id}": capacity muss eine ganze Zahl ≥ 1 sein.`);
}
if (new Set(events.map((e) => e.id)).size !== events.length)
  throw new Error("Zwei Events haben dieselbe id – ids müssen eindeutig sein.");

export function findEvent(id: string): GruppettoEvent | undefined {
  return events.find((e) => e.id === id);
}

/** Anmeldeschluss: closesAt oder Beginn des Event-Tages (Europe/Berlin). */
export function registrationClosesAt(event: GruppettoEvent): Date {
  const raw = event.registration?.closesAt ?? `${event.dateISO}T00:00`;
  // Ohne Zeitzonenangabe als deutsche Zeit interpretieren (grob: MEZ/MESZ).
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(raw)) return new Date(raw);
  const month = Number(raw.slice(5, 7));
  const offset = month >= 4 && month <= 10 ? "+02:00" : "+01:00";
  return new Date(`${raw}${raw.length === 16 ? ":00" : ""}${offset}`);
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
}
