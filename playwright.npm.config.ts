import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/npm-browser",
  use: { baseURL: "http://127.0.0.1:5174", headless: true },
  webServer: {
    command: "npm --prefix examples/npm run dev",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: true,
  },
  reporter: "list",
});
