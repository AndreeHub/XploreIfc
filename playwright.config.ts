import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  webServer: process.env.PW_XPLOREIFC_EXTERNAL_SERVER
    ? undefined
    : {
        command: "npm run dev -- --port 4177",
        url: "http://127.0.0.1:4177",
        reuseExistingServer: true,
        timeout: 120_000
      },
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
