import { defineConfig, devices } from "@playwright/test";

process.env.DISPATCH_VISUAL_PORT ??= "48471";
const seededPort = Number(process.env.DISPATCH_VISUAL_PORT);
const freshPort = seededPort + 1;
const galleryPort = seededPort + 2;
process.env.DISPATCH_VISUAL_NOW ??= "2026-10-01T12:00:00.000Z";

export default defineConfig({
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixels: 0,
    },
  },
  use: {
    ...devices["Desktop Chrome"],
    colorScheme: "dark",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    locale: "en-US",
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    trace: "off",
  },
  webServer: [
    {
      command: `node tests/visual/seed.mjs seeded ${seededPort}`,
      url: `http://127.0.0.1:${seededPort}/api/board`,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      command: `node tests/visual/seed.mjs fresh ${freshPort}`,
      url: `http://127.0.0.1:${freshPort}/api/board`,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${galleryPort} --strictPort`,
      url: `http://127.0.0.1:${galleryPort}/gallery.html`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
