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
  /** Link zum Strava-Event / zur Route (optional) */
  strava?: string;
  /** "code" = hier in der Datei, "admin" = in der Verwaltung angelegt */
  source?: "code" | "admin";
}

/** Datum als "12. Dezember 2026" */
export function germanDateLabel(dateISO: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateISO}T12:00:00Z`),
  );
}

export const events: GruppettoEvent[] = [
  {
    id: "2026-kaffeeroestung-roastbears",
    title: "Kaffeeröstung bei den Roastbears",
    dateISO: "2026-06-10",
    dateLabel: "10. Juni 2026",
    time: "",
    location: "",
    level: "",
    description:
      "Schau den Roastbears beim Rösten über die Schulter: Wir sind live dabei, wenn die Bohnen in die Trommel kommen – danach gibt's eine offene Fragerunde zu allem rund um Kaffee, von der Bohne bis in die Tasse.",
    image: "", // Bild folgt
  },
  {
    id: "2026-franztrail-faeschd",
    title: "Franztrail Fäschd",
    dateISO: "2026-06-13",
    dateLabel: "13. Juni 2026",
    time: "",
    location: "",
    level: "",
    description:
      "Geführte Gravel- und Rennradtouren vom Gruppetto Tübingen beim Franztrail Fäschd.",
    image: "", // Bild folgt
  },
  {
    id: "2026-no-time-triathlon",
    title: "No Time Triathlon",
    dateISO: "2026-06-20",
    dateLabel: "20. Juni 2026",
    time: "",
    location: "",
    level: "",
    description:
      "Noch nie einen Triathlon gemacht? Swim, Bike, Run – ohne Zeitmessung, einfach zum Reinschnuppern!",
    image: "", // Bild folgt
  },
  {
    id: "2026-everesting",
    title: "Everesting",
    dateISO: "2026-07-11",
    dateLabel: "11. Juli 2026",
    time: "",
    location: "",
    level: "",
    description:
      "Unser bekanntestes Format geht in Runde 2 – wie viele Höhenmeter schaffst du diesmal?",
    image: "", // Bild folgt
  },
  {
    id: "2026-triathlon-stimmungsnest",
    title: "Tübingen Triathlon Stimmungsnest",
    dateISO: "2026-07-19",
    dateLabel: "19. Juli 2026",
    time: "",
    location: "",
    level: "",
    description:
      "Zusammen mit dem OneMoreMile Runclub feuern wir euch beim Mey Generalbau Triathlon Tübingen an.",
    image: "", // Bild folgt
  },
  {
    id: "2026-girls-ride",
    title: "Girls Ride",
    dateISO: "2026-08-08",
    dateLabel: "8. August 2026",
    time: "",
    location: "",
    level: "",
    description:
      "More to come!",
    image: "", // Bild folgt
  },
  {
    id: "2026-christmas-ride",
    title: "Christmas Ride",
    dateISO: "2026-12-12",
    dateLabel: "12. Dezember 2026",
    time: "12:00 Uhr",
    location: "Treffpunkt: Gartenstraße 235, Tübingen",
    level: "Infos folgen",
    description: "Unser Christmas Ride zum Jahresende. Die Route wird noch veröffentlicht.",
    image: "/images/christmas-ride.jpg",
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
