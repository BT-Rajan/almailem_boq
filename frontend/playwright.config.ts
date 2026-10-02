import { defineConfig } from '@playwright/test';

/** iPad checks (Chunk 17): the real UI at both orientations, touch enabled, API mocked. */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', hasTouch: true, deviceScaleFactor: 2 },
  projects: [
    { name: 'ipad-landscape', use: { viewport: { width: 1024, height: 768 } } },
    { name: 'ipad-portrait', use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: 'vite --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
