// Browser smoke test of the demo, run in CI against `vite preview` (no accounts connected).
// node tests/e2e/smoke.cjs [site]   — default http://localhost:4173/
// Fails on any page error, any accessibility violation in the checked areas, or a missing expected result.
const { chromium } = require('playwright');
const fs = require('fs');
const SITE = process.argv[2] || 'http://localhost:4173/';
const axePath = process.env.AXE_PATH || require.resolve('axe-core/axe.min.js');
const axeSource = fs.readFileSync(axePath, 'utf8');
const failures = [];
const check = (ok, rule) => { console.log(`${ok ? 'ok' : 'FAILED'} - ${rule}`); if (!ok) failures.push(rule); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const axe = async (name, selector) => {
    await page.waitForTimeout(600); // let entrance animations finish, or colors read faded
    await page.addScriptTag({ content: axeSource });
    const found = await page.evaluate(async target => (await window.axe.run(document.querySelector(target), { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id} (${v.nodes.length})`), selector);
    check(found.length === 0, `no accessibility violations: ${name}${found.length ? ` → ${found.join(', ')}` : ''}`);
  };
  const role = label => page.locator('.preview-roles button', { hasText: label }).first().click();

  await page.goto(SITE); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.getByRole('button', { name: /Explore the demo/ }).click();

  // Director: a no-finals district contest, scheduled and scored with sample results.
  await role('Director');
  await page.getByLabel('Final round').selectOption('prelims');
  await page.getByLabel('This is a district contest').check();
  await axe('director details', '.setup-main');
  await page.getByRole('tab', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Build schedule' }).first().click();
  check(await page.locator('.section-grid article').count() > 0, 'the schedule builds rooms');
  await page.locator('.director-tabs button', { hasText: 'Results' }).click();
  await page.getByRole('button', { name: /Fill in sample results/ }).first().click();
  await page.waitForTimeout(300);
  const rows = await page.locator('.results-row:not(.results-head)').allInnerTexts();
  check(rows.some(row => /State qualifier/.test(row)) && rows.some(row => /Alternate/.test(row)), 'district results mark State qualifiers and an alternate');
  await axe('results', '.results-layout');
  await page.locator('.director-tabs button', { hasText: 'Print' }).click();
  for (const label of ['Director guide', 'Judge quick-start']) {
    await page.getByRole('tab', { name: label }).click();
    check(await page.locator('.print-doc .print-guide').count() === 1, `the Print center has the ${label.toLowerCase()}`);
  }
  await axe('print center guides', '.print-center');
  await page.locator('.director-tabs button', { hasText: 'Setup' }).click();
  await page.getByRole('tab', { name: 'Review' }).click();
  for (const step of [/^Publish/, /^Start/]) { const button = page.locator('.run-steps button', { hasText: step }).first(); if (await button.isEnabled()) await button.click(); await page.waitForTimeout(200); }
  await page.getByRole('tab', { name: 'Details' }).click();
  check(await page.getByLabel('Final round').isDisabled(), 'the final-round format locks once the tournament starts');

  // Coach: paste a roster and several judges.
  await page.locator('.director-tabs button', { hasText: 'Setup' }).click().catch(() => {});
  await page.getByRole('tab', { name: 'Review' }).click(); await page.locator('.run-undo').click(); await page.getByRole('button', { name: 'Reopen registration' }).click();
  await role('Coach');
  await page.getByRole('button', { name: 'Add students' }).first().click();
  await page.getByRole('button', { name: 'Upload or paste' }).click();
  await page.getByLabel(/Or paste from a spreadsheet/).fill('Student\tEvents\tDivision\nPaste Person\tInformative Speaking (INF)\tVarsity\nNew Novice\tNovice Poetry\t');
  await page.getByRole('button', { name: 'Check pasted rows' }).click();
  check(/2 ready to add/.test(await page.locator('.csv-summary').innerText()), 'a pasted roster is read, event codes and all');
  await axe('add students', '.entry-import');
  await page.getByRole('button', { name: /^Add 2/ }).click();
  await page.getByRole('button', { name: 'View team entries' }).first().click();
  await page.locator('.cj-bulk summary').click();
  await page.getByLabel(/Paste from a spreadsheet/).fill('name\temail\nPat Rivera\tpat@example.org');
  await page.getByRole('button', { name: 'Check pasted judges' }).click();
  await page.getByRole('button', { name: /^Add 1 judge/ }).click(); await page.waitForTimeout(300);
  check(/Pat Rivera/.test(await page.locator('.cj-list').innerText()), 'pasted judges are added');

  // Public pages.
  await page.goto(SITE + '#/results'); await page.waitForTimeout(800);
  check(await page.locator('main').innerText().then(text => /Tournament results/.test(text)), 'public results open without an account');
  await axe('public results', 'main');
  await page.goto(SITE + '#/calendar'); await page.waitForTimeout(800);
  await axe('public calendar', 'main');

  // Phone: nothing scrolls sideways, and an opened ballot comes into view.
  const { devices } = require('playwright');
  const phone = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  phone.on('pageerror', error => errors.push(`phone: ${error}`));
  const sideways = async name => { const [scroll, width] = await phone.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); check(scroll <= width, `phone: ${name} does not scroll sideways (${scroll}px in ${width}px)`); };
  await phone.goto(SITE); await phone.evaluate(() => localStorage.clear()); await phone.reload();
  await phone.getByRole('button', { name: /Explore the demo/ }).click();
  await phone.locator('.preview-roles button', { hasText: 'Director' }).first().click(); await sideways('director setup');
  await phone.getByRole('tab', { name: 'Schedule' }).click(); await phone.getByRole('button', { name: 'Build schedule' }).first().click(); await sideways('schedule');
  await phone.getByRole('tab', { name: 'Review' }).click();
  for (const step of [/^Publish/, /^Start/]) await phone.locator('.run-steps button', { hasText: step }).first().click();
  await phone.locator('.preview-roles button', { hasText: 'Judge' }).first().click(); await sideways('judge');
  await phone.locator('.demo-rooms button', { hasText: 'Open ballot' }).first().click();
  await phone.waitForSelector('.jb-strip'); await phone.waitForTimeout(900);
  const top = await phone.evaluate(() => document.querySelector('.jb').getBoundingClientRect().top);
  check(top >= 0 && top < 300, `phone: an opened ballot is in view (top at ${Math.round(top)}px)`);
  await sideways('ballot');
  await phone.goto(SITE + '#/results'); await phone.waitForTimeout(600); await sideways('public results');

  check(errors.length === 0, `no page errors${errors.length ? ` → ${errors.join(' | ')}` : ''}`);
  await browser.close();
  if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
  console.log('\nAll browser checks passed.');
})().catch(error => { console.log('FAILED -', error.message.split('\n').slice(0, 3).join(' ')); process.exit(1); });
