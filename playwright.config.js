import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  workers: 2,
  projects: [
    { name: 'Chromium', use: { browserName: 'chromium' } },
    { name: 'Firefox', use: { browserName: 'firefox' } },
  ],
});
