import { defineConfig } from "@playwright/test";

/* Browser tests against `wrangler dev --env local` (offline: local D1 and R2, the stand-in AI model).
   `npm run test:e2e` starts the server itself. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: "http://localhost:8787", viewport: { width: 1280, height: 900 },
    // a pre-installed Chromium can be named here (PW_CHROMIUM=/path/to/chrome); otherwise Playwright's own
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  },
  webServer: {
    command: "node scripts/dev-seed.mjs --fresh && npx wrangler dev --env local --port 8787",
    url: "http://localhost:8787/api/ping",
    reuseExistingServer: true,
    timeout: 120000
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium" } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
