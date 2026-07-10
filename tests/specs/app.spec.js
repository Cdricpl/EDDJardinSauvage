// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tests end-to-end en MODE DÉMO.
 *
 * On force le mode démo en remplaçant js/config.js par une config vide (aucune
 * clé Supabase), et on coupe les CDN externes pour rester déterministe et
 * hors-ligne. L'application gère l'absence de Chart.js / jsPDF (dégradé).
 */
async function setupDemo(page) {
  await page.route('**/js/config.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'window.APP_CONFIG = {};' }));
  await page.route(/cdn\.jsdelivr\.net/, (route) => route.abort());
}

async function loginAdmin(page) {
  await page.goto('/index.html');
  await expect(page.locator('#loginBtn')).toBeVisible();
  // En mode démo, les identifiants admin sont pré-remplis.
  await page.locator('#loginBtn').click();
  await expect(page.locator('#appShell')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await setupDemo(page);
});

test('connexion admin puis navigation entre les 5 onglets sans écran blanc', async ({ page }) => {
  await loginAdmin(page);
  const tabs = ['sheet', 'recap', 'children', 'stats', 'employees'];
  for (const v of tabs) {
    await page.locator(`.navbtn[data-v="${v}"]`).click();
    // Le contenu se rend et aucun message fatal n'apparaît.
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(page.locator('#app .msg.error strong')).toHaveCount(0);
  }
});

test('feuille du mois : modifier l’horaire réel met à jour le total presté', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const before = await page.locator('#tWorked').textContent();
  // Premier sélecteur d'heure de fin réelle modifiable → on l'allonge à 21:00.
  const endSel = page.locator('select[data-k="end_time"]:not([disabled])').first();
  await endSel.selectOption('21:00');

  await expect(page.locator('#tWorked')).not.toHaveText(before || '');
});

test('enfants : ajouter un enfant puis cocher une présence incrémente son total', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();

  await page.locator('#kFirst').fill('Testprenom');
  await page.locator('#kLast').fill('Zztest');
  await page.locator('#kAdd').click();

  const row = page.locator('table.attend tbody tr', { hasText: 'Testprenom' });
  await expect(row).toHaveCount(1);
  // Un enfant neuf a 0 présence ; on coche le premier jour.
  await row.locator('input.pres').first().check();
  await expect(row.locator('.kidtot strong')).toHaveText('1');
});

test('sauvegarde : l’export JSON déclenche un téléchargement', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();
  await expect(page.locator('#expJson')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#expJson').click(),
  ]);
  expect(download.suggestedFilename()).toContain('edd-sauvegarde');
});

test('règle métier : le mois précédent est bloqué en janvier 2026', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  const prev = page.locator('#prevM');
  // On recule jusqu'à ce que le bouton se désactive (janvier 2026 = premier mois).
  for (let i = 0; i < 60; i++) {
    if (await prev.isDisabled()) break;
    await prev.click();
  }
  await expect(prev).toBeDisabled();
});

test('feuille : valider un mois bascule le bouton en « Repasser en cours »', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  const btn = page.locator('#validBtn');
  await expect(btn).toContainText('Valider');
  await btn.click();
  await expect(page.locator('#validBtn')).toContainText('Repasser');
});

test('feuille : un écart non justifié affiche la bannière d’avertissement', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#warnBanner')).toBeHidden();
  // On allonge l'horaire réel du 1er jour → écart sans justification.
  await page.locator('select[data-k="end_time"]:not([disabled])').first().selectOption('21:00');
  await expect(page.locator('#warnBanner')).toBeVisible();
});

test('restauration : importer une sauvegarde JSON remplace les données', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();

  const backup = JSON.stringify({
    kids: [{ id: 'imp1', first_name: 'Importe', last_name: 'Test', active: true }],
    kid_attendance: [],
  });
  await page.locator('#impFile').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup),
  });
  page.on('dialog', (d) => d.accept()); // confirme le remplacement
  await page.locator('#impBtn').click();

  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend tbody tr', { hasText: 'Importe' })).toHaveCount(1);
});
