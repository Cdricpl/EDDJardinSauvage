// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Les tests s'exécutent en MODE DÉMO (localStorage) : déterministes, hors-ligne,
 * sans Firebase. Un petit serveur statique sert la racine du dépôt.
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
    /* Service worker désactivé pendant les tests.
     * Il court-circuite l'interception réseau de Playwright : les requêtes qu'il
     * émet lui-même n'étaient PAS interceptées, si bien que `setupDemo` croyait
     * neutraliser js/config.js alors que la vraie configuration Firebase était
     * servie. Les tests ne tombaient en mode démo que par un repli accidentel.
     * Le test du numéro de version lit sw.js directement (page.request.get) et
     * n'a donc pas besoin d'un service worker actif. */
    serviceWorkers: 'block',
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
