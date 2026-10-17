// @ts-check
import { defineConfig } from 'astro/config';
import { apiDevServer } from './dev/api-dev-server.mjs';

// https://astro.build/config
export default defineConfig({
  // Nur im Dev-Server (StackBlitz): /api/* im Testmodus ohne Netlify/Stripe
  vite: { plugins: [apiDevServer()] },
});
