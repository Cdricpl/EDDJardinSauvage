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
