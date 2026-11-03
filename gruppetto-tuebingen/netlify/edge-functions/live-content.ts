// Edge Function: holt vor dem Ausliefern die aktuellen Events und Website-Schalter und schreibt sie
// direkt ins HTML (siehe src/lib/live-html.ts). So sieht man auf der Startseite, den Weekly Rides
// und den Rookies sofort den aktuellen Stand statt kurz den vom letzten Build.
// Klappt etwas nicht (Timeout, Fehler), geht die Seite unverändert raus – das Script im Browser
// aktualisiert dann wie bisher.
import type { Config, Context } from "@netlify/edge-functions";
import { applyLive, type LiveData } from "../../src/lib/live-html.ts";

const EVENT_PAGES = new Set(["/", "/rookies"]);

const problems: string[] = [];
async function getJSON<T>(url: URL, pass: Headers): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500), headers: pass });
    if (!res.ok) problems.push(`${url.pathname}:${res.status}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch (e) {
    problems.push(`${url.pathname}:${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export default async (req: Request, context: Context) => {
  const res = await context.next();
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const original = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");

  problems.length = 0;
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const api = (p: string) => new URL(p, url.origin);
    // Zugangsdaten des Besuchers durchreichen (z. B. Passwortschutz der Deploy-Previews)
    const pass = new Headers({ accept: "application/json" });
    for (const h of ["cookie", "authorization"]) {
      const v = req.headers.get(h);
      if (v) pass.set(h, v);
    }
    const [events, settings, seats] = await Promise.all([
      EVENT_PAGES.has(path) ? getJSON<LiveData["events"]>(api("/api/events"), pass) : null,
      getJSON<LiveData["settings"]>(api("/api/site-settings"), pass),
      path === "/" ? getJSON<LiveData["seats"]>(api("/api/event-status"), pass) : null,
    ]);
    const html = applyLive(path, original, { events: Array.isArray(events) ? events : null, settings, seats });
    headers.set("cache-control", "public, max-age=0, must-revalidate");
    // Diagnose (im Browser unter Netzwerk → Antwort-Header sichtbar)
    headers.set("x-gt-live", problems.length ? `teilweise: ${problems.join(", ")}`.slice(0, 300) : "ok");
    return new Response(html, { status: res.status, headers });
  } catch (e) {
    console.error("live-content", e);
    headers.set("x-gt-live", `fehler: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    return new Response(original, { status: res.status, headers });
  }
};

export const config: Config = {
  path: "/*",
  excludedPath: ["/api/*", "/_astro/*", "/images/*", "/vendor/*", "/fonts/*", "/.well-known/*", "/*.css", "/*.js", "/*.jpg", "/*.png", "/*.webp", "/*.svg", "/*.ico", "/*.mp4", "/*.webm", "/*.gpx", "/*.webmanifest", "/*.txt", "/*.xml"],
};
