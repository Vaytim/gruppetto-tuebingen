// GET /api/event-video?id=… – Reel-Videos aus der Verwaltung ausliefern.
// Unterstützt Range-Anfragen (so lädt der Browser Videos ohnehin) und liefert pro
// Antwort höchstens ein gespeichertes Stück aus – das bleibt unter dem Function-Limit.
import type { Config } from "@netlify/functions";
import { videoStore } from "../lib/event-store";

export default async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^rv-[a-z0-9-]+$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const vs = videoStore();
  const meta = await vs.getMeta(id);
  if (!meta?.complete) return new Response("Nicht gefunden", { status: 404 });

  const headers = {
    "content-type": meta.contentType,
    "accept-ranges": "bytes",
    // Jede Videoversion hat eine eigene ID → darf lange gecacht werden
    "cache-control": "public, max-age=31536000, immutable",
  };

  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = meta.size - 1;
  if (m) {
    if (m[1] === "" && m[2] !== "") {
      start = Math.max(0, meta.size - Number(m[2])); // "bytes=-500" = die letzten 500 Bytes
    } else {
      start = Number(m[1] || 0);
      if (m[2] !== "") end = Math.min(end, Number(m[2]));
    }
    if (start >= meta.size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${meta.size}` } });
    }
  }

  // Höchstens bis zum Ende des Stücks, in dem "start" liegt
  const n = Math.floor(start / meta.chunkSize);
  const chunkStart = n * meta.chunkSize;
  end = Math.min(end, chunkStart + meta.chunkSize - 1);
  const chunk = await vs.getChunk(id, n);
  if (!chunk) return new Response("Nicht gefunden", { status: 404 });
  const body = new Uint8Array(chunk).slice(start - chunkStart, end - chunkStart + 1);

  if (!m && meta.chunks === 1) return new Response(body, { status: 200, headers });
  return new Response(body, {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${meta.size}`, "content-length": String(body.byteLength) },
  });
};

export const config: Config = { path: "/api/event-video" };
