// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tests end-to-end en MODE DÉMO.
 *
 * On force le mode démo en remplaçant js/config.js par une config vide (aucune
 * clé Firebase), et on coupe les CDN externes pour rester déterministe et
 * hors-ligne. L'application gère l'absence de Chart.js / jsPDF (dégradé).
 */
async function setupDemo(page) {
  /* Le motif doit accepter le paramètre de version : l'application demande
   * « js/config.js?v=vAAAA.MM.JJ-N », qu'un glob « **\/js/config.js » ne
   * reconnaît pas. Tant qu'il ne correspondait pas, la vraie configuration
   * Firebase était servie et les tests ne basculaient en mode démo que parce
   * que les CDN coupés faisaient échouer Firebase — un repli accidentel, pas
   * le mode démo explicite qu'on croyait tester. */
  await page.route(/\/js\/config\.js/, (route) =>
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

test('règle métier : le mois précédent est bloqué en août 2026', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  const prev = page.locator('#prevM');
  // On recule jusqu'à ce que le bouton se désactive (août 2026 = premier mois).
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
  // Budget : ~140 heures repliées + ~280 pour la colonne « Midi » (9 choix/jour).
  const auRepos = await page.locator('#app option').count();
  expect(auRepos).toBeLessThan(600);

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
  const vide = page.locator('table.attend tbody button.presbtn.pres-v').first();
  const numJour = Number(((await vide.getAttribute('data-date')) || '').slice(8));
  const jourAvant = Number(await page.locator(`[data-daytot="${numJour}"]`).first().textContent());

  // On coche une case encore VIDE : viser « la première » dépendrait de la date
  // du jour (les données de démo remplissent le mois jusqu'à aujourd'hui).
  const cases = page.locator('table.attend tbody button.presbtn.pres-v');
  await expect(cases.first()).toBeVisible();
  await cases.first().click();

  // Les DEUX lignes doivent suivre : elles portent le même repère, pas un id unique.
  await expect(totaux.first()).toHaveText(String(avant + 1));
  await expect(totaux.last()).toHaveText(String(avant + 1));

  // Le total du JOUR aussi, en haut comme en bas.
  const totJour = page.locator(`[data-daytot="${numJour}"]`);
  await expect(totJour).toHaveCount(2);
  await expect(totJour.first()).toHaveText(String(jourAvant + 1));
  await expect(totJour.last()).toHaveText(String(jourAvant + 1));
});

test('enfants : rien n’est encodable avant le premier jour d’accueil', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend')).toBeVisible();

  /* Se placer explicitement sur AOÛT 2026. Sans cela le test dépendait de la
   * date du jour : dès que l'horloge est passée en septembre, la grille
   * affichait un mois entièrement encodable et l'assertion tombait. */
  const prevM = page.locator('#prevM');
  for (let i = 0; i < 60; i++) {
    if (await prevM.isDisabled()) break;
    await prevM.click();
  }
  await expect(page.locator('.toolbar strong')).toContainText('août 2026');

  // Août 2026 : aucun accueil du 1er au 23 inclus. Ces cases sont neutralisées
  // (ce ne sont pas des boutons), donc rien ne peut y être coché ni pré-encodé.
  const ligne = page.locator('table.attend tbody tr').first();
  for (const jour of [1, 10, 23]) {
    const cell = ligne.locator('td.daycell').nth(jour - 1);
    await expect(cell.locator('button')).toHaveCount(0);
    await expect(cell.locator('.pres-off')).toHaveCount(1);
  }
  // Le 24 août, l'encodage redevient possible.
  const cell24 = ligne.locator('td.daycell').nth(23);
  await expect(cell24.locator('button.presbtn')).toHaveCount(1);
  await expect(cell24.locator('button.presbtn')).toHaveAttribute('data-date', '2026-08-24');
});

test('règle métier : juillet 2026 et les mois antérieurs sont inaccessibles', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  const prev = page.locator('#prevM');
  for (let i = 0; i < 60; i++) {
    if (await prev.isDisabled()) break;
    await prev.click();
  }
  // Le programme est proposé aux employées à partir d'août 2026 : rien avant.
  await expect(page.locator('.toolbar strong')).toContainText('août 2026');
  await expect(prev).toBeDisabled();
});

test('admin : le solde de départ se saisit une fois et alimente le report', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();

  // Heures supplémentaires déjà accumulées avant la mise en service.
  const champ = page.locator('input.opening').first();
  await expect(champ).toBeVisible();
  await champ.fill('12h30');
  await champ.blur();
  await expect(page.locator('input.opening').first()).toHaveValue('+12h30');

  // Ce solde devient le report du premier mois, sans rien saisir d'autre.
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tCarry')).toHaveText('12h30');

  // Une saisie incompréhensible est refusée plutôt que devinée.
  await page.locator('.navbtn[data-v="employees"]').click();
  const champ2 = page.locator('input.opening').first();
  await champ2.fill('nimportequoi');
  await champ2.blur();
  await expect(page.locator('#toast')).toContainText('Solde non compris');
  await expect(page.locator('input.opening').first()).toHaveValue('+12h30');
});

/** Connexion en tant qu'employée (mode démo). */
async function loginEmployee(page) {
  await page.goto('/index.html');
  await expect(page.locator('#loginBtn')).toBeVisible();
  await page.locator('#email').fill('flora@ecole.be');
  await page.locator('#pwd').fill('flora123');
  await page.locator('#loginBtn').click();
  await expect(page.locator('#appShell')).toBeVisible();
}

test('employée : l’onglet Statistiques n’est pas accessible', async ({ page }) => {
  await loginEmployee(page);
  // L'onglet est retiré de la navigation tant qu'il n'est pas finalisé.
  await expect(page.locator('.navbtn[data-v="stats"]')).toHaveCount(0);
  await expect(page.locator('.navbtn')).toHaveCount(3);

  // Et l'accès direct (état résiduel) retombe sur la feuille, sans écran blanc.
  await page.evaluate(() => { window.VIEW = 'stats'; });
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('#app .msg.error strong')).toHaveCount(0);

  // L'administrateur, lui, y a toujours accès.
  await page.locator('#logoutBtn').click();
  await loginAdmin(page);
  await expect(page.locator('.navbtn[data-v="stats"]')).toHaveCount(1);
});

test('employée : fiches enfants en lecture seule, avec qui contacter', async ({ page }) => {
  await loginEmployee(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend')).toBeVisible();

  // Aucun moyen de modifier une fiche : ni bouton, ni formulaire dans la page.
  await expect(page.locator('#kToggle')).toHaveCount(0);
  await expect(page.locator('#addKidCard')).toHaveCount(0);
  await expect(page.locator('#editKidCard')).toHaveCount(0);
  await expect(page.locator('[data-editkid], [data-arch]')).toHaveCount(0);

  // Mais la marche à suivre est indiquée.
  const msg = page.locator('#app .msg').first();
  await expect(msg).toContainText('changement de situation');
  await expect(msg).toContainText('Stéphanie Lejeune');
  await expect(msg).toContainText('PIELTAIN Cédric');

  // L'encodage des présences, lui, reste possible.
  await expect(page.locator('table.attend tbody button.presbtn').first()).toBeEnabled();
});

test('feuille : le temps de midi est déduit des heures prestées', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  const row = await firstWorkedRow(page);

  const avantJour = (await row.locator('.c-worked').innerText()).trim();
  const avantMois = await page.locator('#tWorked').innerText();

  // 30 minutes de pause de midi, non comptées dans la prestation.
  await row.locator('[data-k="break_minutes"]').selectOption('30');
  await expect(row.locator('.c-worked')).not.toHaveText(avantJour);
  await expect(page.locator('#tWorked')).not.toHaveText(avantMois);

  // 4h00 - 30 min = 3h30 ; l'écart vaut exactement la pause.
  await expect(row.locator('.c-worked')).toContainText('3h30');
  await expect(row.locator('.c-delta')).toHaveText('-0h30');

  // Remise à zéro : on retrouve la durée d'origine.
  await row.locator('[data-k="break_minutes"]').selectOption('0');
  await expect(row.locator('.c-worked')).toContainText(avantJour);
});

test('enfants : trois états — présent, absence justifiée, absence injustifiée', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();
  const premiere = page.locator('table.attend tbody button.presbtn.pres-v').first();
  await expect(premiere).toBeVisible();
  // Localisateur figé sur CETTE case : viser « .pres-v en premier » désignerait
  // une autre case dès que celle-ci change d'état.
  const kid = await premiere.getAttribute('data-kid');
  const date = await premiere.getAttribute('data-date');
  const c = page.locator(`button.presbtn[data-kid="${kid}"][data-date="${date}"]`);

  // Vide → présent → absence justifiée → absence injustifiée → vide.
  await c.click();
  await expect(c).toHaveClass(/pres-p/); await expect(c).toHaveText('✓');
  await c.click();
  await expect(c).toHaveClass(/pres-a/); await expect(c).toHaveText('✗');
  await c.click();
  await expect(c).toHaveClass(/pres-nj/); await expect(c).toHaveText('!');
  await expect(c).toHaveAttribute('aria-label', /absence injustifiée/);
  await c.click();
  await expect(c).toHaveClass(/pres-v/); await expect(c).toHaveText('');

  // Une absence, quelle qu'elle soit, ne compte jamais comme une présence.
  await c.click(); await c.click();                       // → absence justifiée
  const jour = Number(date.slice(8));
  const totAvant = Number(await page.locator(`[data-daytot="${jour}"]`).first().textContent());
  await c.click();                                        // → absence injustifiée
  await expect(page.locator(`[data-daytot="${jour}"]`).first()).toHaveText(String(totAvant));
});

test('enfants : la fiche du mois est consultable, y compris par une employée', async ({ page }) => {
  await loginEmployee(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('#ficheEnfant')).toBeHidden();

  await page.locator('[data-fiche]').first().click();
  const fiche = page.locator('#ficheEnfant');
  await expect(fiche).toBeVisible();
  await expect(fiche).toContainText('Présences');
  await expect(fiche).toContainText('Absences justifiées');
  await expect(fiche).toContainText('Absences injustifiées');

  await page.locator('#ficheClose').click();
  await expect(fiche).toBeHidden();
});

test('utilisateurs : supprimer un compte exige une double confirmation', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();
  // Cet onglet contient plusieurs tableaux (soldes de fin d'année, utilisateurs) :
  // on vise explicitement celui des utilisateurs.
  const lignes = page.locator('#usersTable tbody tr');
  const avant = await lignes.count();

  // Ni son propre compte, ni le dernier administrateur ne sont supprimables.
  await expect(page.locator('[data-del]')).toHaveCount(avant - 1);

  // Un nom mal recopié annule la suppression.
  const dialogues = ['', 'nom incorrect'];
  const handler = async (d) => d.accept(dialogues.shift() ?? '');
  page.on('dialog', handler);
  await page.locator('[data-del]').last().click();
  await expect(page.locator('#toast')).toContainText('annulée');
  await expect(lignes).toHaveCount(avant);
  page.off('dialog', handler);

  // Le nom exact confirme la suppression.
  const suppr = page.locator('[data-del]').last();
  // Le nom seul : la cellule contient aussi le bouton crayon.
  const nom = await suppr.evaluate((b) => b.closest('tr').children[0].childNodes[0].textContent.trim());
  const dialogues2 = ['', nom];
  page.on('dialog', (d) => d.accept(dialogues2.shift() ?? ''));
  await suppr.click();
  await expect(lignes).toHaveCount(avant - 1);
});

test('enfants : seul l’administrateur peut effacer définitivement un enfant', async ({ page }) => {
  // Une employée consulte la fiche mais n'y trouve aucun moyen d'effacer.
  await loginEmployee(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await page.locator('[data-fiche]').first().click();
  await expect(page.locator('#ficheEnfant')).toBeVisible();
  await expect(page.locator('#ficheDel')).toHaveCount(0);

  // L'administrateur, lui, dispose du bouton — protégé par une double confirmation.
  await page.locator('#logoutBtn').click();
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();
  const avant = await page.locator('table.attend tbody tr').count();
  // Le prénom RÉEL, pas le texte affiché : la grille met les noms en capitales
  // par CSS, et `innerText` renverrait « EMMA » là où la fiche attend « Emma ».
  const id = await page.locator('[data-fiche]').first().getAttribute('data-fiche');
  const prenom = await page.evaluate((kid) => {
    const db = JSON.parse(localStorage.getItem('ecole_db'));
    return (db.kids.find((k) => k.id === kid) || {}).first_name;
  }, id);
  await page.locator('[data-fiche]').first().click();
  await expect(page.locator('#ficheDel')).toHaveCount(1);

  // Un prénom mal recopié annule l'effacement.
  const faux = ['', 'pas le bon'];
  const h1 = async (d) => d.accept(faux.shift() ?? '');
  page.on('dialog', h1);
  await page.locator('#ficheDel').click();
  await expect(page.locator('#toast')).toContainText('annulé');
  await expect(page.locator('table.attend tbody tr')).toHaveCount(avant);
  page.off('dialog', h1);

  // Le bon prénom efface l'enfant et ses présences.
  const vrai = ['', prenom];
  page.on('dialog', (d) => d.accept(vrai.shift() ?? ''));
  await page.locator('#ficheDel').click();
  await expect(page.locator('table.attend tbody tr')).toHaveCount(avant - 1);
});

test('utilisateurs : le bouton Supprimer est visible sans défilement', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();
  const btn = page.locator('[data-del]').first();
  await expect(btn).toBeVisible();
  // La cellule était en `nowrap` : le 3e bouton sortait du cadre défilant.
  const dansLeCadre = await btn.evaluate((b) => {
    const r = b.getBoundingClientRect();
    const w = b.closest('.table-wrap').getBoundingClientRect();
    return r.right <= w.right + 1 && r.left >= w.left - 1;
  });
  expect(dansLeCadre, 'le bouton Supprimer doit tenir dans le cadre visible').toBe(true);
});

test('feuille : le temps de midi n’exige aucune justification', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#warnBanner')).toBeHidden();

  // Une ligne sans écart au départ.
  const idx = await page.evaluate(() => [...document.querySelectorAll('#sheetTable tbody tr')]
    .findIndex((r) => {
      const s = r.querySelector('[data-k="start_time"]');
      const e = r.querySelector('[data-k="end_time"]');
      return s && e && s.value && e.value && r.querySelector('.c-delta').textContent.trim() === '—';
    }));
  expect(idx).toBeGreaterThanOrEqual(0);
  const row = page.locator('#sheetTable tbody tr').nth(idx);
  const justif = row.locator('.c-justif input');

  // La pause creuse un écart… mais elle l'explique déjà d'elle-même.
  await row.locator('[data-k="break_minutes"]').selectOption('45');
  await expect(row.locator('.c-delta')).toHaveText('-0h45');
  await expect(justif).toHaveAttribute('placeholder', '');
  await expect(justif).not.toHaveClass(/err/);
  await expect(page.locator('#warnBanner')).toBeHidden();

  // En revanche, un horaire réellement différent du prévu reste à justifier.
  await pickTime(row.locator('[data-k="end_time"]'), '21:00');
  await expect(justif).toHaveAttribute('placeholder', 'Justification requise');
  await expect(page.locator('#warnBanner')).toBeVisible();
});

test('entête : le raccourci « Installer » est proposé à tous', async ({ page }) => {
  await loginEmployee(page);
  // Le raccourci n'a rien d'administratif : chacune doit pouvoir le créer.
  await expect(page.locator('#installBtn')).toBeVisible();

  // Sans prise en charge native (cas d'un navigateur tiers), on explique la
  // marche à suivre au lieu de ne rien faire.
  let message = null;
  page.on('dialog', async (d) => { message = d.message(); await d.accept(); });
  await page.locator('#installBtn').click();
  await expect.poll(() => message).toContain('Installer');
});

test('enfants : la fiche du mois s’exporte en PDF', async ({ page }) => {
  await loginEmployee(page);            // une employée doit pouvoir l'exporter
  await page.locator('.navbtn[data-v="children"]').click();

  // jsPDF vient d'un CDN, coupé pendant les tests : on le remplace par un
  // double qui enregistre ce que l'application lui demande.
  await page.evaluate(() => {
    window.__pdf = { tables: [], saved: null, texts: [] };
    class FauxDoc {
      setFontSize() {} setTextColor() {} addImage() {}
      text(t) { window.__pdf.texts.push(t); }
      autoTable(o) {
        window.__pdf.tables.push({ head: o.head, lignes: (o.body || []).length });
        this.lastAutoTable = { finalY: window.__pdf.tables.length * 40 };
      }
      save(n) { window.__pdf.saved = n; }
    }
    window.jspdf = { jsPDF: FauxDoc };
  });

  await page.locator('[data-fiche]').first().click();
  await expect(page.locator('#fichePdf')).toBeVisible();
  await page.locator('#fichePdf').click();

  const r = await expect.poll(async () => (await page.evaluate(() => window.__pdf)).saved).toBeTruthy()
    .then(() => page.evaluate(() => window.__pdf));
  expect(r.saved).toMatch(/^fiche_.+_\d{4}-\d{2}\.pdf$/);
  // Le PDF reprend les trois blocs de la fiche affichée.
  expect(r.tables).toHaveLength(3);
  expect(r.texts.join(' ')).toContain('Fiche de présence');
  // Et aucune erreur n'a été signalée à l'utilisatrice.
  await expect(page.locator('#toast')).not.toContainText('impossible');
});

test('utilisateurs : la colonne Actions tient sur une seule ligne', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();
  const cellule = page.locator('#usersTable tbody tr').nth(1).locator('td.actions');
  await expect(cellule.locator('button')).toHaveCount(3);

  // Avec des libellés, cette colonne occupait trois lignes par utilisateur.
  const mesures = await cellule.evaluate((td) => {
    const b = [...td.querySelectorAll('button')];
    const haut = b[0].getBoundingClientRect().top;
    return {
      alignes: b.every((x) => Math.abs(x.getBoundingClientRect().top - haut) < 2),
      hauteurLigne: td.closest('tr').getBoundingClientRect().height,
    };
  });
  expect(mesures.alignes, 'les actions doivent rester alignées sur une ligne').toBe(true);
  expect(mesures.hauteurLigne).toBeLessThan(100);
});

test('enfants retirés : ils restent effaçables définitivement', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="children"]').click();
  await expect(page.locator('table.attend')).toBeVisible();

  // On retire un enfant de la liste (archivage).
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-arch]').first().click();
  await page.locator('#showArch').check();

  /* Une fiche archivée ne figure plus dans la grille : sa fiche du mois — le
   * seul autre endroit d'où l'effacer — devient inatteignable. La liste des
   * enfants retirés doit donc porter elle aussi le bouton d'effacement. */
  await expect(page.locator('[data-delkid]')).toHaveCount(1);

  const cible = await page.evaluate(() => {
    const id = document.querySelector('[data-delkid]').dataset.delkid;
    const db = JSON.parse(localStorage.getItem('ecole_db'));
    return { prenom: db.kids.find((k) => k.id === id).first_name, id };
  });

  // Effacement : fiche ET présences disparaissent.
  const rep = ['', cible.prenom];
  page.on('dialog', (d) => d.accept(rep.shift() ?? ''));
  await page.locator('[data-delkid]').first().click();

  await expect.poll(async () => page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem('ecole_db'));
    return db.kids.some((k) => k.id === id) || db.kidatt.some((a) => a.kid_id === id);
  }, cible.id)).toBe(false);
});

test('exports : le temps de midi et le statut des présences y figurent', async ({ page }) => {
  await loginAdmin(page);

  // Un jour avec 45 minutes de temps de midi.
  await page.locator('.navbtn[data-v="sheet"]').click();
  const row = await firstWorkedRow(page);
  const jour = await row.locator('[data-k="start_time"]').getAttribute('data-date');
  await row.locator('[data-k="break_minutes"]').selectOption('45');
  await expect(row.locator('.c-worked')).toContainText('3h15');

  // Une absence injustifiée.
  await page.locator('.navbtn[data-v="children"]').click();
  // Localisateur FIGÉ sur cette case : « la première .pres-v » désignerait une
  // autre case dès le premier clic, puisque la classe change.
  const vide = page.locator('table.attend tbody button.presbtn.pres-v').first();
  const kid = await vide.getAttribute('data-kid');
  const dateAbs = await vide.getAttribute('data-date');
  const c = page.locator(`button.presbtn[data-kid="${kid}"][data-date="${dateAbs}"]`);
  await c.click(); await c.click(); await c.click();          // → absence injustifiée
  await expect(c).toHaveClass(/pres-nj/);

  await page.locator('.navbtn[data-v="employees"]').click();

  /* Sans la colonne « Temps de midi », une ligne « 14:00 → 18:00, presté 195 »
   * est inexplicable pour qui lit le fichier. */
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.locator('#expCsvPresta').click()]);
  const presta = (await (await dl1.createReadStream()).toArray()).join('');
  expect(presta).toContain('Temps de midi (min)');
  const ligne = presta.split('\r\n').find((l) => l.includes(jour));
  expect(ligne, 'la ligne doit porter les 45 minutes déduites').toContain(';45;');

  /* Le fichier des présences contient AUSSI les absences : sans statut, elles
   * étaient comptées comme des présences, y compris dans un dossier d'agrément. */
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('#expCsvKids').click()]);
  const kids = (await (await dl2.createReadStream()).toArray()).join('');
  expect(kids).toContain('Statut');
  expect(kids).not.toContain('Date de présence');
  const ligneAbs = kids.split('\r\n').find((l) => l.includes(dateAbs));
  expect(ligneAbs).toContain('Absence injustifiée');
});

test('restauration Firebase : le solde de départ revient, mais jamais les droits', async ({ page }) => {
  await loginAdmin(page);

  /* Le chemin FIREBASE de la restauration a sa propre liste de champs : c'est
   * là qu'un oubli passe inaperçu, le mode démo recopiant tout en bloc.
   * On instancie donc FirebaseStore avec un faux Firestore et on regarde
   * exactement ce qu'il écrit. */
  const ecrites = await page.evaluate(async () => {
    const ecrites = [];
    const col = (nom) => ({
      doc: (id) => ({ __col: nom, __id: id }),
      where: () => col(nom),
      get: async () => ({ docs: [], size: 0, empty: true }),
    });
    const st = Object.create(FirebaseStore.prototype);
    st.db = { collection: col };
    st._memo = new Map(); st._entriesCache = {}; st._profilesCache = null;
    st.listProfiles = async () => ([{ id: 'uid-reel', email: 'flora@ecole.be', full_name: 'Employée 1' }]);
    st._commit = async (ops) => ops.forEach((o) => {
      if (!o.delete) ecrites.push({ col: o.ref.__col, id: o.ref.__id, data: o.data });
    });
    await st.importAll({
      profiles: [{
        id: 'ancien', email: 'flora@ecole.be', opening_minutes: 435,
        role: 'admin', active: false, full_name: 'Renommée',   // ne doivent PAS être restaurés
      }],
      day_entries: [{ id: 'x', employee_id: 'ancien', entry_date: '2026-08-26', break_minutes: 45 }],
      kid_attendance: [{ kid_id: 'k1', entry_date: '2026-08-26', status: 'unjustified' }],
      kids: [{ id: 'k1', first_name: 'Emma', last_name: 'B', school: 'ARAHF', grade: '5e', birthdate: '2015-09-15', days: [1, 2] }],
    });
    return ecrites;
  });

  // Le solde de départ est bien restauré (sinon tout le cumul d'heures est faux).
  const profil = ecrites.find((e) => e.col === 'profiles');
  expect(profil, 'le solde de départ doit être restauré').toBeTruthy();
  expect(profil.data.opening_minutes).toBe(435);
  // …mais RIEN d'autre : une sauvegarde trafiquée ne doit pas pouvoir accorder
  // des droits d'administrateur ni désactiver un compte.
  expect(Object.keys(profil.data)).toEqual(['opening_minutes']);

  // Et les champs récents des autres tables survivent aussi.
  expect(ecrites.find((e) => e.col === 'day_entries').data.break_minutes).toBe(45);
  expect(ecrites.find((e) => e.col === 'kid_attendance').data.status).toBe('unjustified');
  const enfant = ecrites.find((e) => e.col === 'kids').data;
  expect(enfant.grade).toBe('5e');
  expect(enfant.days).toEqual([1, 2]);
});

/* ================================================================
 * Journée entière récupérée, en congé ou de maladie.
 *
 * Avant l'ajout de la colonne « Journée », une journée entière récupérée était
 * INENCODABLE : effacer les deux heures réelles la faisait compter comme
 * entièrement prestée, et mettre la même heure au début et à la fin était
 * refusé. Ces tests verrouillent le comportement attendu.
 * ================================================================ */

// Le menu de la colonne « Journée » de la première ligne réellement travaillée.
async function jourTypeSelect(page) {
  return (await firstWorkedRow(page)).locator('[data-k="jour_type"]');
}

test('feuille : « Récup. » met la journée à 0 h et fait baisser le solde', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const row = await firstWorkedRow(page);
  const prevu = await row.locator('[data-k="planned_start"]').inputValue();
  expect(prevu, 'la ligne testée doit avoir un horaire prévu').not.toBe('');
  const presteAvant = await row.locator('.c-worked').textContent();

  await row.locator('[data-k="jour_type"]').selectOption('recup');

  // La journée ne compte plus aucune heure, et l'écart devient négatif.
  await expect(row.locator('.c-worked')).toHaveText('—');
  await expect(row.locator('.c-delta')).toHaveClass(/neg/);
  const ecart = await row.locator('.c-delta').textContent();
  expect(ecart, 'l’écart doit être négatif').toMatch(/^-/);
  expect(presteAvant, 'la journée était bien prestée avant').not.toBe('—');

  // L'horaire réel n'a plus de sens : il est grisé.
  await expect(row.locator('[data-k="start_time"]')).toBeDisabled();
  await expect(row.locator('[data-k="end_time"]')).toBeDisabled();
});

test('feuille : « Congé » compte comme presté, le solde ne bouge pas', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const row = await firstWorkedRow(page);
  const cumuleAvant = await page.locator('#tClosing').textContent();

  await row.locator('[data-k="jour_type"]').selectOption('conge');

  await expect(row.locator('.c-delta')).toHaveText('—');
  await expect(page.locator('#tClosing')).toHaveText(cumuleAvant || '');
});

test('feuille : revenir à « — » rétablit l’horaire prévu', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const row = await firstWorkedRow(page);
  const debutPrevu = await row.locator('[data-k="planned_start"]').inputValue();
  const presteAvant = await row.locator('.c-worked').textContent();

  await row.locator('[data-k="jour_type"]').selectOption('recup');
  await expect(row.locator('.c-worked')).toHaveText('—');

  await row.locator('[data-k="jour_type"]').selectOption('');
  await expect(row.locator('[data-k="start_time"]')).toBeEnabled();
  await expect(row.locator('[data-k="start_time"]')).toHaveValue(debutPrevu);
  await expect(row.locator('.c-worked')).toHaveText(presteAvant || '');
});

test('feuille : une journée typée n’exige pas de justification écrite', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const row = await firstWorkedRow(page);
  await row.locator('[data-k="jour_type"]').selectOption('recup');

  // L'écart est pourtant non nul : c'est le motif qui tient lieu d'explication.
  await expect(row.locator('.c-delta')).toHaveClass(/neg/);
  await expect(row.locator('.c-justif input')).not.toHaveClass(/err/);
  await expect(page.locator('#warnBanner')).toBeHidden();
});

test('feuille : le motif de journée survit à un rechargement', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();

  const row = await firstWorkedRow(page);
  const date = await row.locator('[data-k="jour_type"]').getAttribute('data-date');
  await row.locator('[data-k="jour_type"]').selectOption('maladie');
  await expect(row.locator('.c-delta')).toHaveText('—');

  // Rechargement complet : le champ doit avoir été réellement enregistré.
  // (C'est ce test qui attrape un oubli dans la liste blanche du store.)
  // La session est conservée : on revient directement sur la feuille.
  await page.reload();
  await expect(page.locator('#sheetTable')).toBeVisible();

  const sel = page.locator(`[data-k="jour_type"][data-date="${date}"]`);
  await expect(sel).toHaveValue('maladie');
  await expect(page.locator(`[data-k="start_time"][data-date="${date}"]`)).toBeDisabled();
});

/* Usage réel : le programme sert surtout sur ORDINATEUR. Avec la largeur de
 * lecture (1060 px), la feuille et ses 11 colonnes débordaient de 40 px sur tous
 * les écrans testés — il fallait la faire défiler pour lire la justification,
 * pendant qu'il restait jusqu'à 860 px d'écran inutilisés. */
test('feuille : sur un écran d’ordinateur, la grille tient sans défilement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#sheetTable')).toBeVisible();

  const m = await page.evaluate(() => {
    const tbl = document.getElementById('sheetTable');
    const just = document.querySelector('.c-justif input');
    return {
      debordement: tbl.scrollWidth - tbl.closest('.table-wrap').clientWidth,
      justification: Math.round(just.getBoundingClientRect().width),
    };
  });
  expect(m.debordement, 'la feuille ne doit plus défiler horizontalement').toBeLessThanOrEqual(0);
  // Le champ de justification n'est plus écrasé à sa largeur minimale (131 px).
  expect(m.justification).toBeGreaterThan(200);

  // Les onglets de lecture gardent la largeur de lecture, eux.
  await page.locator('.navbtn[data-v="recap"]').click();
  await expect(page.locator('#app table')).toBeVisible();
  expect(await page.evaluate(() => Math.round(document.querySelector('.container').getBoundingClientRect().width))).toBe(1060);
});

/* Le pré-remplissage était réservé à l'administration ET exigeait un mois vide.
 * Mesuré : si l'employée ouvrait le mois neuf en premier et encodait un seul
 * jour, le mois n'était plus vide et ne serait JAMAIS pré-rempli — elle voyait
 * « +4h00 d'écart non justifié » sur une journée normale. */
test('feuille : un mois neuf ouvert par l’employée est pré-rempli', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#loginBtn')).toBeVisible();
  await page.locator('#email').fill('flora@ecole.be');
  await page.locator('#pwd').fill('flora123');
  await page.locator('#loginBtn').click();
  await expect(page.locator('#sheetTable')).toBeVisible();

  // Mois suivant : aucun jour n'y a encore été encodé.
  await page.locator('#nextM').click();
  await expect(page.locator('#tPlanned')).toBeVisible();
  const prevus = await page.evaluate(() => [...document.querySelectorAll('#sheetTable tbody tr')]
    .filter((r) => r.querySelector('[data-k="planned_start"]').value).length);
  expect(prevus, 'les jours de l’horaire type doivent être pré-remplis').toBeGreaterThan(15);
  // Et donc aucun écart fantôme.
  await expect(page.locator('#warnBanner')).toBeHidden();

  // L'écart se calcule bien par rapport à l'horaire prévu ainsi posé.
  const row = await firstWorkedRow(page);
  await pickTime(row.locator('[data-k="end_time"]'), '17:00');
  await expect(row.locator('.c-delta')).toHaveText('-1h00');
});

test('feuille : un mois entamé sans horaire prévu se répare à l’ouverture suivante', async ({ page }) => {
  await loginAdmin(page);
  // On recrée l'état hérité : un jour encodé dans un mois sans horaire prévu.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('ecole_db'));
    const d = new Date(); const y = d.getFullYear(), m = d.getMonth() + 2;   // mois suivant
    const date = `${y}-${String(m).padStart(2, '0')}-15`;
    db.entries.push({ id: 'legacy', employee_id: 'u-flora', entry_date: date,
      planned_start: '', planned_end: '', planned_minutes: 0,
      start_time: '14:00', end_time: '18:00', worked_minutes: 240, worked_touched: true, justification: '' });
    localStorage.setItem('ecole_db', JSON.stringify(db));
  });
  await page.locator('#empSel').selectOption({ label: 'Employée 1' });
  await page.locator('#nextM').click();
  await expect(page.locator('#tPlanned')).toBeVisible();

  const prevus = await page.evaluate(() => [...document.querySelectorAll('#sheetTable tbody tr')]
    .filter((r) => r.querySelector('[data-k="planned_start"]').value).length);
  expect(prevus, 'le mois doit être pré-rempli malgré le jour déjà encodé').toBeGreaterThan(15);
  // Les heures déjà encodées sont conservées.
  const ligne = page.locator('#sheetTable tbody tr').filter({ has: page.locator('[data-date$="-15"]') });
  await expect(ligne.locator('[data-k="start_time"]')).toHaveValue('14:00');
  await expect(ligne.locator('[data-k="end_time"]')).toHaveValue('18:00');
});

/* Les écouteurs temps réel étaient bornés à l'ANNÉE CIVILE alors que l'année
 * scolaire va d'août à juillet : la moitié de chaque année n'était jamais
 * suivie, et l'écran de l'administration affichait des chiffres périmés.
 * Ce test parle à un faux Firestore qui enregistre les requêtes : c'est le seul
 * moyen de vérifier une borne sans toucher à la vraie base. */
test('temps réel : les écouteurs suivent l’année scolaire, pas l’année civile', async ({ page }) => {
  await page.goto('/index.html');
  const res = await page.evaluate(async () => {
    let anneeEnBase = 2026;
    const poses = [];
    const rappels = {};
    const query = (col) => ({
      col, wheres: [],
      where(f, op, v) { const q = query(col); q.wheres = this.wheres.concat([[f, op, v]]); return q; },
      onSnapshot(opts, cb) { poses.push({ col, wheres: this.wheres }); rappels[col] = cb; return () => {}; },
    });
    const db = {
      collection: (c) => Object.assign(query(c), {
        doc: (id) => ({ get: async () => ({ exists: true, id,
          data: () => (id === 'app' ? { annee_scolaire: anneeEnBase } : { role: 'admin', active: true }) }) }),
      }),
    };
    let authCb = null;
    const auth = { currentUser: { uid: 'u1' }, setPersistence: async () => {},
                   onAuthStateChanged: (f) => { authCb = f; return () => {}; } };
    const store = new FirebaseStore({ auth: () => auth, firestore: () => db });
    store.onChange(() => {});
    authCb({ uid: 'u1' });
    await new Promise((r) => setTimeout(r, 60));
    const bornes = (col) => {
      const p = [...poses].reverse().find((x) => x.col === col);
      return p.wheres.map((w) => w.join(' ')).join(' | ');
    };
    const avant = { day_entries: bornes('day_entries'), kid_attendance: bornes('kid_attendance') };

    // L'administration ouvre l'année suivante : les écouteurs doivent suivre.
    anneeEnBase = 2027;
    rappels.settings({ metadata: { hasPendingWrites: false }, docChanges: () => [],
      docs: [{ id: 'app', data: () => ({ annee_scolaire: 2027 }) }] });
    await new Promise((r) => setTimeout(r, 80));
    return { avant, apres: { day_entries: bornes('day_entries'), kid_attendance: bornes('kid_attendance') } };
  });

  expect(res.avant.day_entries).toBe('entry_date >= 2026-08-01 | entry_date <= 2027-07-31');
  expect(res.avant.kid_attendance).toBe('entry_date >= 2026-08-01 | entry_date <= 2027-07-31');
  // Une nouvelle année ouverte repose les écouteurs sur la bonne période.
  expect(res.apres.day_entries).toBe('entry_date >= 2027-08-01 | entry_date <= 2028-07-31');
  expect(res.apres.kid_attendance).toBe('entry_date >= 2027-08-01 | entry_date <= 2028-07-31');
});

/* Poser un motif de journée effaçait le temps de midi : en revenant à « — », la
 * journée repartait avec 30 minutes de trop au crédit de l'employée. */
test('feuille : le temps de midi survit à un aller-retour de motif', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="sheet"]').click();
  await expect(page.locator('#tWorked')).toBeVisible();
  const row = await firstWorkedRow(page);

  await row.locator('[data-k="break_minutes"]').selectOption('30');
  await expect(row.locator('.c-worked')).toHaveText('3h30');

  // Motif posé : le temps de midi est masqué (sans objet), mais pas perdu.
  await row.locator('[data-k="jour_type"]').selectOption('recup');
  await expect(row.locator('.c-worked')).toHaveText('—');
  await expect(row.locator('[data-k="break_minutes"]')).toHaveValue('0');
  await expect(row.locator('[data-k="break_minutes"]')).toBeDisabled();

  // Retour à une journée ordinaire : il revient tel quel.
  await row.locator('[data-k="jour_type"]').selectOption('');
  await expect(row.locator('[data-k="break_minutes"]')).toHaveValue('30');
  await expect(row.locator('.c-worked')).toHaveText('3h30');
});

test('exports : le CSV des prestations porte le motif de la journée', async ({ page }) => {
  await loginAdmin(page);
  const row = await firstWorkedRow(page);
  await row.locator('[data-k="jour_type"]').selectOption('recup');
  await expect(row.locator('.c-worked')).toHaveText('—');

  await page.locator('.navbtn[data-v="employees"]').click();
  await expect(page.locator('#expCsvPresta')).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.locator('#expCsvPresta').click();
  const flux = await (await dl).createReadStream();
  let csv = ''; for await (const c of flux) csv += c;

  expect(csv.split('\r\n')[0]).toContain('Motif');
  // Sans cette colonne, une journée récupérée apparaissait à 0 minute, inexpliquée.
  expect(csv).toContain('Récupération');
});

/* Chaque cellule enregistrée faisait DEUX allers-retours l'un après l'autre :
 * l'écriture, puis une relecture de la journée fusionnée. Le faux Firestore
 * ci-dessous compte les appels et vérifie que la fusion refaite en local donne
 * exactement le même document que celui du serveur. */
test('enregistrement : une cellule ne fait qu’un aller-retour', async ({ page }) => {
  await page.goto('/index.html');
  const res = await page.evaluate(async () => {
    const base = {};          // documents « côté serveur »
    const appels = { set: 0, get: 0 };
    const docRef = (col, id) => ({
      async set(data, opts) {
        appels.set++;
        base[id] = (opts && opts.merge) ? { ...(base[id] || {}), ...data } : { ...data };
      },
      async get() { appels.get++; return { id, exists: !!base[id], data: () => ({ ...base[id] }) }; },
    });
    const db = { collection: (c) => ({ doc: (id) => docRef(c, id) }) };
    const store = new FirebaseStore({
      auth: () => ({ setPersistence: async () => {}, onAuthStateChanged: () => () => {} }),
      firestore: () => db,
    });

    // Journée déjà connue (cas courant : la feuille du mois est affichée).
    store._entriesCache['e1'] = [{ id: 'e1_2026-09-01', employee_id: 'e1', entry_date: '2026-09-01',
      planned_start: '14:00', planned_end: '18:00', planned_minutes: 240,
      start_time: '14:00', end_time: '18:00', worked_minutes: 240, break_minutes: 30, justification: 'x' }];
    base['e1_2026-09-01'] = { ...store._entriesCache['e1'][0] };
    const rendu = await store.upsertEntry({ employee_id: 'e1', entry_date: '2026-09-01', jour_type: 'recup',
      start_time: '', end_time: '', worked_touched: true, worked_minutes: 0 });
    const connue = { set: appels.set, get: appels.get };

    // Le document rendu doit être IDENTIQUE à ce que le serveur a réellement enregistré.
    const serveur = { id: 'e1_2026-09-01', ...base['e1_2026-09-01'] };
    const identique = JSON.stringify(Object.entries(rendu).sort()) === JSON.stringify(Object.entries(serveur).sort());

    // Journée inconnue du cache : la relecture reste le filet de sécurité.
    appels.set = 0; appels.get = 0;
    await store.upsertEntry({ employee_id: 'e2', entry_date: '2026-09-02', justification: 'y' });
    return { connue, identique, inconnue: { set: appels.set, get: appels.get }, motif: rendu.jour_type, midi: rendu.break_minutes };
  });

  expect(res.connue).toEqual({ set: 1, get: 0 });      // un seul aller-retour
  expect(res.identique, 'la fusion locale doit donner le document du serveur').toBe(true);
  expect(res.motif).toBe('recup');
  expect(res.midi).toBe(30);                            // les champs non touchés sont conservés
  expect(res.inconnue).toEqual({ set: 1, get: 1 });     // repli quand la journée n'est pas en cache
});

/* L'année scolaire ouverte était lue AVANT l'authentification : les règles
 * Firestore refusent toute lecture à un visiteur non identifié, l'erreur était
 * avalée (« [annee] Missing or insufficient permissions » dans la console) et
 * l'application s'ouvrait sur la première année — close — quelle que soit
 * l'année réellement ouverte. Le faux magasin ci-dessous reproduit ce refus. */
test('démarrage : l’application s’ouvre sur l’année réellement ouverte', async ({ page }) => {
  await page.goto('/index.html');
  const res = await page.evaluate(async () => {
    const journal = [];
    let connectee = false;
    const vrai = new DemoStore();
    const faux = Object.create(Object.getPrototypeOf(vrai));
    Object.assign(faux, vrai);
    faux.getReglages = async () => {
      journal.push(connectee ? 'reglages(connectée)' : 'reglages(AVANT connexion)');
      if (!connectee) throw new Error('Missing or insufficient permissions');
      return { annee_scolaire: 2027 };
    };
    faux.getCurrentUser = async () => {
      journal.push('getCurrentUser');
      connectee = true;
      return { id: 'u-admin', full_name: 'Admin', role: 'admin', active: true };
    };
    createStore = async () => ({ store: faux, mode: 'demo' });
    ME = null;
    await boot();
    await new Promise((r) => setTimeout(r, 300));
    const t = document.querySelector('.toolbar strong');
    return { journal, ANNEE, ANNEE_VUE, mois: t ? t.textContent.trim() : '' };
  });

  // La lecture ne doit jamais précéder l'authentification.
  expect(res.journal[0]).toBe('getCurrentUser');
  expect(res.journal).not.toContain('reglages(AVANT connexion)');
  expect(res.ANNEE).toBe(2027);
  expect(res.ANNEE_VUE).toBe(2027);
  expect(res.mois).toBe('août 2027');
});

/* Le solde reporté est figé à l'ouverture de l'année — c'est le principe retenu.
 * Mais l'administration peut encore corriger une année close, et la correction
 * ne remonte pas : mesuré à l'audit, deux heures disparaissaient en silence.
 * Elle est désormais signalée, et un bouton la reporte. */
test('années : une correction dans l’année close est signalée et reportable', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await loginAdmin(page);
  await page.locator('.navbtn[data-v="employees"]').click();
  await expect(page.locator('#nouvelleAnnee')).toBeVisible();

  // Ouverture de l'année suivante : les soldes de fin deviennent les reports.
  await page.locator('#nouvelleAnnee').click();
  await expect(page.locator('#app h2').first()).toContainText('2027-2028');
  await expect(page.locator('#app .msg.error')).toHaveCount(0);   // rien à signaler

  // Correction d'un jour dans l'année refermée.
  await page.locator('.navbtn[data-v="sheet"]').click();
  await page.locator('#anneeSel').selectOption('2026');
  await expect(page.locator('#tClosing')).toBeVisible();
  await page.locator('#nextM').click();
  const row = await firstWorkedRow(page);
  const avant = await page.locator('#tClosing').textContent();
  await pickTime(row.locator('[data-k="end_time"]'), '20:00');
  await expect(page.locator('#tClosing')).not.toHaveText(avant);

  // Le report de l'année ouverte n'a pas bougé (voulu), mais c'est annoncé.
  await page.locator('.navbtn[data-v="employees"]').click();
  const avert = page.locator('#app .msg.error');
  await expect(avert).toHaveCount(1);
  await expect(avert).toContainText('ne correspond plus');
  await expect(avert).toContainText('recalculé à');

  // Le bouton remet le report à jour.
  await page.locator('#recalcSoldes').click();
  await expect(page.locator('#app .msg.error')).toHaveCount(0);
  // On revient sur l'année ouverte (la consultation était restée sur l'année close).
  await page.locator('.navbtn[data-v="sheet"]').click();
  await page.locator('#anneeSel').selectOption('2027');
  await expect(page.locator('.toolbar strong').first()).toHaveText(/août 2027/i);
  await expect(page.locator('#tCarry')).toHaveText('1h45');
});

/* L'inscription Firebase est ouverte (c'est par elle que l'onglet Utilisateurs
 * crée les comptes) et la configuration du projet est publique : l'application
 * créait alors elle-même une fiche « employée active » pour tout compte
 * authentifié sans fiche — n'importe qui pouvait donc se fabriquer un accès aux
 * données des enfants. Elle refuse désormais, et le dit. */
test('accès : un compte authentifié sans fiche est refusé, pas provisionné', async ({ page }) => {
  await page.goto('/index.html');
  const res = await page.evaluate(async () => {
    const journal = [];
    const db = { collection: (c) => ({ doc: (id) => ({
      get: async () => { journal.push('lecture ' + c + '/' + id); return { exists: false, id, data: () => ({}) }; },
      set: async () => { journal.push('ECRITURE ' + c + '/' + id); },
    }) }) };
    const auth = { currentUser: { uid: 'inconnu', email: 'inconnu@example.com' },
      setPersistence: async () => {}, onAuthStateChanged: () => () => {},
      signOut: async () => { journal.push('signOut'); } };
    const store = new FirebaseStore({ auth: () => auth, firestore: () => db });
    let erreur = null;
    try { await store.getCurrentUser(); } catch (e) { erreur = { code: e.code, message: e.message }; }
    return { journal, erreur };
  });

  expect(res.erreur && res.erreur.code).toBe('non-autorise');
  expect(res.erreur.message).toContain("n'est pas autorisé");
  // Le point essentiel : AUCUNE fiche n'est écrite.
  expect(res.journal.filter((l) => l.startsWith('ECRITURE'))).toHaveLength(0);

  // Et l'écran correspondant est explicite, sans jargon de permission.
  const ecran = await page.evaluate(() => {
    showNonAutorise("Ce compte n'est pas autorisé à utiliser le programme.");
    return { titre: document.querySelector('#login h1').textContent,
             shell: document.getElementById('appShell').style.display };
  });
  expect(ecran.titre).toBe('Accès non autorisé');
  expect(ecran.shell).toBe('none');
});

/* `chart.js@4` suivait toutes les versions 4.x à venir : le graphique pouvait se
 * casser sans aucun déploiement de notre côté. Toute adresse de CDN doit porter
 * une version exacte — c'est ce que ce test empêche de perdre. */
test('bibliothèques externes : les versions du CDN sont figées à l’unité près', async ({ page }) => {
  const source = await (await page.request.get('/js/app.js')).text();
  const urls = source.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^']+/g) || [];
  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) {
    expect(u, `version non figée : ${u}`).toMatch(/@\d+\.\d+\.\d+(\/|$)/);
  }
  expect(urls.some((u) => u.includes('chart.js@4.5.1'))).toBe(true);
});

/* Le pré-remplissage écrit le mois entier : un mois à venir s'affichait
 * « Total presté 88h00 » alors que rien n'avait été travaillé. Les totaux
 * restent ceux du mois complet (sinon l'écart, donc le solde, serait faux) ;
 * une mention dit ce qui est réellement presté à ce jour. */
test('feuille : un mois à venir annonce ce qui est réellement presté', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('#empSel').selectOption({ label: 'Employée 1' });
  const mention = page.locator('#app p:has-text("Jours à venir compris")');

  // Mois suivant : entièrement à venir.
  await page.locator('#nextM').click();
  await expect(page.locator('#tPlanned')).toBeVisible();
  await expect(mention).toHaveCount(1);
  await expect(mention).toContainText('0h00');
  // Les totaux du mois complet, eux, ne bougent pas.
  await expect(page.locator('#tWorked')).toHaveText(await page.locator('#tPlanned').textContent());
  await expect(page.locator('#tDelta')).toHaveText('—');

  // Un mois passé n'affiche rien de plus.
  await page.locator('#prevM').click();
  await page.locator('#prevM').click();
  await expect(page.locator('.toolbar strong').first()).toHaveText(/août 2026/i);
  await expect(mention).toHaveCount(0);
});
