// Vite-Plugin NUR für `astro dev` (StackBlitz / lokal ohne Netlify):
// Leitet /api/* an dieselben Handler weiter, die auf Netlify als Functions laufen.
// Ohne STRIPE_SECRET_KEY wird der Testmodus aktiv: Speicher im Arbeitsspeicher,
// Test-Bezahlseite statt Stripe, Test-Postfach statt echter Mail.
// Beim Build (`astro build` auf Netlify) ist dieses Plugin nicht aktiv.

const ROUTES = {
  "/api/checkout": "/netlify/functions/checkout.mts",
  "/api/event-status": "/netlify/functions/event-status.mts",
  "/api/stripe-webhook": "/netlify/functions/stripe-webhook.mts",
  "/api/teilnehmer": "/netlify/functions/teilnehmer.mts",
  "/api/site-settings": "/netlify/functions/site-settings.mts",
  "/api/events": "/netlify/functions/events.mts",
  "/api/event-image": "/netlify/functions/event-image.mts",
  "/api/test-zahlung": "/dev/test-zahlung.ts",
  "/api/test-postfach": "/dev/test-postfach.ts",
};

export function apiDevServer() {
  return {
    name: "gruppetto-api-dev-server",
    apply: "serve",
    configureServer(server) {
      // Unter `netlify dev` mit echten Schlüsseln übernimmt Netlify selbst.
      if (process.env.STRIPE_SECRET_KEY) return;
      process.env.GRUPPETTO_TESTMODUS = "1";
      server.config.logger.info("\n  🧪 Anmeldung im TESTMODUS: keine echte Zahlung, Mails im Test-Postfach (/api/test-postfach)\n");

      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        const file = ROUTES[path];
        if (!file) return next();
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
            method: req.method,
            headers: Object.entries(req.headers).flatMap(([k, v]) =>
              v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x]),
            ),
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          const mod = await server.ssrLoadModule(file);
          const response = await mod.default(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error(`[api-dev-server] ${path}`, err);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: `Interner Fehler im Testmodus: ${err?.message ?? err}` }));
        }
      });
    },
  };
}
