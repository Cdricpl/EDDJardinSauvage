// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Les tests s'exécutent en MODE DÉMO (localStorage) : déterministes, hors-ligne,
 * sans Supabase. Un petit serveur statique sert la racine du dépôt.
 */
const PORT = 4173;

module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Permet de pointer un binaire Chromium déjà présent (ex. environnement CI
        // avec navigateur pré-installé). Ignoré si la variable n'est pas définie.
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  // Sert la racine du dépôt (dossier parent de tests/).
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
