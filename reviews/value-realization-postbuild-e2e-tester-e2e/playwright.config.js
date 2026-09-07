// Playwright config for the isolated, non-shipping e2e-tester fixture project.
// Per the persona's recorded Windows lesson (2026-09-03 ai-flight-deck), the built-in
// `webServer` option is deliberately NOT used: on this host it can leave a grandchild
// server process alive after the run and hang final-summary reporting. The server is
// started and stopped explicitly by the test runner script instead (see run-e2e.ps1).
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./specs",
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/html-report" }]
  ],
  use: {
    baseURL: process.env.AFD_E2E_BASE_URL || "http://127.0.0.1:9411",
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure"
  },
  outputDir: "artifacts/test-results",
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.js/
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.js/
    }
  ]
});
