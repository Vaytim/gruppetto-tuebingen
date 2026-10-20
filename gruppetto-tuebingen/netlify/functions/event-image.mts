// GET /api/event-image?id=… – Event-Bilder aus der Verwaltung ausliefern.
import type { Config } from "@netlify/functions";
import { imageStore } from "../lib/event-store";

export default async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const img = await imageStore().get(id);
  if (!img) return new Response("Nicht gefunden", { status: 404 });
  return new Response(img.data, {
    headers: {
      "content-type": img.contentType,
      // Jede neue Bildversion bekommt eine neue ID → darf lange gecacht werden
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

export const config: Config = { path: "/api/event-image" };
