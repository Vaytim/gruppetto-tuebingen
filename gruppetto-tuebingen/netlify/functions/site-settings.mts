// GET /api/site-settings – öffentliche Website-Schalter (z. B. Off-Season).
// Umschalten passiert passwortgeschützt in der Verwaltung (/api/teilnehmer).
import type { Config } from "@netlify/functions";
import { json, ledgerStore } from "../lib/services";
import { readSettings } from "../lib/settings";

export default async () => {
  const { offseason } = await readSettings(ledgerStore());
  return json({ offseason });
};

export const config: Config = { path: "/api/site-settings" };
