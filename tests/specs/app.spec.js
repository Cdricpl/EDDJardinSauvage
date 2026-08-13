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
  await page.route(/cdn\.jsdelivr\.net|gstatic\.com/, (route) => route.abort());
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

/**
 * Indice de la première ligne de la feuille correspondant à un jour REELLEMENT
 * travaillé (horaire renseigné). Indispensable : selon le mois affiché, les
 * premiers jours peuvent tomber un week-end (aucun horaire) — un test qui
 * viserait « la première ligne » serait fragile au changement de mois.
 */
async function firstWorkedRow(page) {
  const idx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#sheetTable tbody tr')];
    return rows.findIndex((r) => {
      const s = r.querySelector('[data-k="start_time"]');
      const e = r.querySelector('[data-k="end_time"]');
      return s && e && s.value && e.value;
    });
  });
  expect(idx, 'aucun jour travaillé trouvé dans la feuille').toBeGreaterThanOrEqual(0);
  return page.locator('#sheetTable tbody tr').nth(idx);
}

/**
 * Choisit une heure dans un menu de la feuille EN PASSANT PAR LE CLIC, comme le
 * ferait une utilisatrice. Nécessaire : pour rester rapide, un menu d'heures ne
 * contient au repos que sa valeur affichée ; ses créneaux ne sont créés qu'au
 * premier clic (ou au focus clavier). Un `selectOption` seul ne les verrait pas.
 */
async function pickTime(select, value) {
  await select.click();
  await select.selectOption(value);
}

test('feuille du mois : modifier l’horaire réel met à jour le total presté', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const before = await page.locator('#tWorked').textContent();
  // On allonge l'horaire réel d'un jour travaillé jusqu'à 21:00.
  const row = await firstWorkedRow(page);
  await pickTime(row.locator('[data-k="end_time"]'), '21:00');

  await expect(page.locator('#tWorked')).not.toHaveText(before || '');
});

test('enfants : ajouter un enfant puis cocher une présence incrémente son total', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();

  await page.locator('#kToggle').click();   // le formulaire d'ajout est replié par défaut
  await page.locator('#kFirst').fill('Testprenom');
  await page.locator('#kLast').fill('Zztest');
  await page.locator('#kAdd').click();

  const row = page.locator('table.attend tbody tr', { hasText: 'Testprenom' });
  await expect(row).toHaveCount(1);
  // Un enfant neuf a 0 présence ; un clic sur la 1re case = présent (✓).
  await row.locator('button.presbtn').first().click();
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

test('entête : le numéro de version est affiché et correspond au cache du service worker', async ({ page }) => {
  await loginAdmin(page);
  const version = (await page.locator('#appVersion').textContent() || '').trim();
  expect(version).toMatch(/^v\d{4}\.\d{2}\.\d{2}-\d+$/);
  // Le nom du cache doit suivre la version, sinon un appareil hors ligne
  // afficherait un numero a jour tout en servant d'anciens fichiers.
  const sw = await (await page.request.get('/sw.js')).text();
  expect(sw).toContain(`edd-jardin-sauvage-${version}`);

  // Les scripts doivent porter la version dans leur URL. Sans cela le
  // navigateur peut resservir un ancien js/app.js pendant des heures et
  // l'utilisatrice croit que la mise à jour n'est pas passée.
  const html = await (await page.request.get('/index.html')).text();
  for (const f of ['css/styles.css', 'js/config.js', 'js/store.js', 'js/app.js']) {
    expect(html, `${f} doit être versionné dans index.html`).toContain(`${f}?v=${version}`);
  }
});

test('entête : le bouton 💾 déclenche une sauvegarde (admin)', async ({ page }) => {
  await loginAdmin(page);
  const backup = page.locator('#backupBtn');
  await expect(backup).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    backup.click(),
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
  // On allonge l'horaire réel d'un jour travaillé → écart sans justification.
  const row = await firstWorkedRow(page);
  await pickTime(row.locator('[data-k="end_time"]'), '21:00');
  await expect(page.locator('#warnBanner')).toBeVisible();
});

test('performance : les menus d’heures se remplissent au clic (feuille allégée)', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#sheetTable')).toBeVisible();

  // Au repos la feuille reste légère : sans ce remplissage différé elle
  // contiendrait plusieurs milliers de balises <option> et deviendrait saccadée.
  const auRepos = await page.locator('#app option').count();
  expect(auRepos).toBeLessThan(300);

  // Mais un clic doit bien proposer TOUS les créneaux (6:00 → 21:00 au quart d'heure).
  const sel = (await firstWorkedRow(page)).locator('[data-k="end_time"]');
  await expect(sel.locator('option')).toHaveCount(1);
  await sel.click();
  await expect(sel.locator('option')).toHaveCount(61 + 1); // créneaux + « --:-- »

  // Et la tabulation au clavier doit les remplir aussi (accessibilité).
  const autre = (await firstWorkedRow(page)).locator('[data-k="start_time"]');
  await autre.focus();
  await expect(autre.locator('option')).toHaveCount(61 + 1);
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

test('restauration : la fiche complète de l’enfant est conservée (école, naissance, jours)', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();

  // Ces trois champs alimentent les critères d'agrément et le pré-encodage :
  // une restauration qui les perdrait viderait silencieusement les statistiques.
  const backup = JSON.stringify({
    kids: [{
      id: 'imp2', first_name: 'Fiche', last_name: 'Complete',
      school: 'ARAHF', birthdate: '2015-09-15', days: [1, 2, 4, 5], active: true,
    }],
  });
  await page.locator('#impFile').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup),
  });
  page.on('dialog', (d) => d.accept());
  await page.locator('#impBtn').click();

  await page.locator('.navbtn[data-v="children"]').click();
  const row = page.locator('table.attend tbody tr', { hasText: 'Fiche' });
  await expect(row).toHaveCount(1);
  // Les jours habituels sont rappelés à côté du nom.
  await expect(row.locator('.kidname')).toContainText('Lun Mar Jeu Ven');

  await row.locator('[data-editkid]').click();
  await expect(page.locator('#editKidCard')).toBeVisible();
  await expect(page.locator('#eSchool')).toHaveValue('ARAHF');
  await expect(page.locator('#eBirth')).toHaveValue('2015-09-15');
  await expect(page.locator('input.ek:checked')).toHaveCount(4);
});

test('liste de l’école : le fichier livré se restaure avec année, école et jours', async ({ page }) => {
  await loginAdmin(page);

  // Le fichier de la liste 2025-2026 est livré avec l'application ; il se charge
  // par « Restaurer une sauvegarde ». Ce test vérifie qu'il reste bien formé.
  const liste = await (await page.request.get('/import-enfants-2025-2026.json')).text();
  expect(JSON.parse(liste).kids).toHaveLength(12);

  await page.locator('.navbtn[data-v="employees"]').click();
  await page.locator('#impFile').setInputFiles({
    name: 'liste.json', mimeType: 'application/json', buffer: Buffer.from(liste),
  });
  page.on('dialog', (d) => d.accept());
  await page.locator('#impBtn').click();

  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend tbody tr')).toHaveCount(12);
  // L'année scolaire et l'implantation sont rappelées à côté du nom.
  const row = page.locator('table.attend tbody tr', { hasText: 'BENALI' });
  // Année, école et jours habituels sont empilés sous le nom, chacun sur sa ligne.
  await expect(row.locator('.kidmeta').nth(0)).toHaveText('5e');
  await expect(row.locator('.kidmeta').nth(1)).toHaveText('ARAHF');
  await expect(row.locator('.kidmeta').nth(2)).toHaveText('Habituels : Lun Mar Jeu Ven');
  // La pastille d'initiales reprend l'initiale du nom puis du prénom.
  await expect(row.locator('.avatar')).toHaveText('BY');
});

test('enfants : l’année scolaire est enregistrée à la création et modifiable', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();

  await page.locator('#kToggle').click();   // le formulaire d'ajout est replié par défaut
  await page.locator('#kFirst').fill('Annee');
  await page.locator('#kLast').fill('Zztest');
  await page.locator('#kGrade').selectOption('4e');
  await page.locator('#kSchool').selectOption('ARAHF');
  await page.locator('#kAdd').click();

  const row = page.locator('table.attend tbody tr', { hasText: 'Annee' });
  await expect(row.locator('.kidmeta').nth(0)).toHaveText('4e');
  await expect(row.locator('.kidmeta').nth(1)).toHaveText('ARAHF');

  // Modification via la fiche.
  await row.locator('[data-editkid]').click();
  await expect(page.locator('#eGrade')).toHaveValue('4e');
  await page.locator('#eGrade').selectOption('6e');
  await page.locator('#eSave').click();
  await expect(page.locator('table.attend tbody tr', { hasText: 'Annee' }).locator('.kidname')).toContainText('6e');
});

test('enfants : les 31 jours tiennent à l’écran et les repères restent visibles', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend')).toBeVisible();

  // Tout le mois doit être lisible d'un coup, sans défilement latéral.
  const jours = await page.locator('.attend thead tr:first-child .daycol').count();
  expect(jours).toBeGreaterThanOrEqual(28);
  const deborde = await page.locator('.attend-wrap')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(deborde, 'la grille ne doit pas défiler horizontalement').toBe(false);

  // Les totaux figurent en haut ET en bas.
  await expect(page.locator('.attend thead .totrow')).toHaveCount(1);
  await expect(page.locator('.attend tfoot .totrow')).toHaveCount(1);

  // En descendant dans la liste, on doit toujours voir à quel jour on est :
  // l'en-tête et les totaux restent collés au cadre.
  await page.locator('.attend-wrap').evaluate((el) => { el.scrollTop = 350; });
  const visible = await page.locator('.attend-wrap').evaluate((el) => {
    const w = el.getBoundingClientRect();
    const dedans = (sel) => {
      const r = el.querySelector(sel).getBoundingClientRect();
      return r.top >= w.top - 2 && r.bottom <= w.bottom + 2;
    };
    return {
      jours: dedans('thead tr:first-child .daycol'),
      haut: dedans('thead .totrow .kidtot'),
      bas: dedans('tfoot .totrow .kidtot'),
    };
  });
  expect(visible).toEqual({ jours: true, haut: true, bas: true });
});

test('enfants : un clic met à jour les deux lignes de totaux', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend')).toBeVisible();

  const totaux = page.locator('[data-grandtot]');
  await expect(totaux).toHaveCount(2);          // une en haut, une en bas
  const avant = Number(await totaux.first().textContent());

  await page.locator('button.presbtn.pres-p').first().click();
  // Les DEUX doivent suivre : elles portent le même repère, pas un id unique.
  await expect(totaux.first()).toHaveText(String(avant - 1));
  await expect(totaux.last()).toHaveText(String(avant - 1));
});
