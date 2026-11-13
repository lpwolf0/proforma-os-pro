const { chromium } = require('playwright'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const CFG = "export const SUPABASE_URL='https://t.supabase.co';export const SUPABASE_ANON_KEY='anon';";
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const stub = async (pg) => { await pg.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase.js')) })); await pg.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CFG })); };
  await stub(p);
  let genBody = null, genAuth = null;
  await p.route('**/api/generate', async (r) => { genBody = JSON.parse(r.request().postData()); genAuth = r.request().headers().authorization;
    await p.evaluate((id) => { const i = window.__db.proformas.find((x) => x.id === id); i.pdf_path = id + '/proforma-x.pdf'; i.pdf_generated_at = new Date(Date.now() + 1000).toISOString(); i.updated_at = new Date().toISOString(); }, genBody.proforma_id);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ path: genBody.proforma_id + '/proforma-x.pdf', url: 'x', ref_no: '001' }) }); });
  const B = 'http://127.0.0.1:8766/';
  // ---- login gate ----
  await p.goto(B); await p.waitForSelector('#f');
  ok(await p.locator('text=Sign up').count() === 0 && await p.locator('text=Create account').count() === 0, 'login page has no sign-up option');
  await p.goto(B + '#/proforma/new'); await p.waitForSelector('#f'); ok(p.url().endsWith('#/login'), 'protected route redirects to login');
  await p.fill('[name=email]', 'a@b.c'); await p.fill('[name=password]', 'wrong'); await p.click('button[type=submit]'); await p.waitForSelector('.toast.bad'); ok(true, 'wrong password rejected');
  await p.fill('[name=password]', 'secret'); await p.click('button[type=submit]'); await p.waitForSelector('.tiles'); ok(true, 'login works -> dashboard');
  ok((await p.textContent('#list')).includes('No proformas yet'), 'dashboard empty state');
  // ---- new proforma: reproduce the original document ----
  await p.click('text=+ New proforma'); await p.waitForSelector('[data-k=ref_no]');
  ok(await p.inputValue('[data-k=ref_no]') === '001', 'first reference is 001');
  ok((await p.inputValue('[data-k=recipient]')).includes('CBM Country Coordination Office'), 'recipient pre-filled from settings');
  await p.fill('[data-k=doc_date]', '2026-10-26'); await p.fill('[data-k=label]', 'CBM October 2026');
  const row = (i, k, v) => p.fill(`[data-row="${i}"][data-rk=${k}]`, v);
  await row(0, 'description', 'Car Hire from Port Harcourt to 2 LGAs (round trip) daily for 2 days (Ikwere, Degema, Okrika, Akuku toru, Asari Toru, Andoni, Opobo\nNkoro, Ahoada East, Etche)');
  await row(0, 'note', 'Required; 28th and 29th October 2026'); await row(0, 'quantity', '2 cars to visit 2 LGAs daily'); await row(0, 'units', '4'); await row(0, 'unit_price', '160000');
  const v = await p.$$eval('[data-ov=vat],[data-ov=total]', (e) => e.map((x) => x.value)); ok(JSON.stringify(v) === '["48,000.00","688,000.00"]', 'VAT 48,000 and total 688,000 ' + v);
  ok(await p.inputValue('[data-rt="0"]') === '640,000.00', 'row total = units x unit price (640,000)');
  ok(await p.inputValue('[data-ov=words]') === 'Six Hundred and Eighty-Eight Thousand Naira Only.', 'amount in words filled automatically');
  await p.waitForTimeout(120); ok((await p.textContent('#pages')).includes('Six Hundred and Eighty-Eight Thousand Naira Only.') && (await p.innerHTML('#pages')).includes('26<sup>th</sup>'), 'preview shows words and ordinal date');
  await p.fill('[data-ov=words]', 'Custom words.'); await p.waitForTimeout(120); ok((await p.textContent('#pages')).includes('Custom words.'), 'typed amount in words overrides'); await p.click('[data-reset=words]');
  ok(await p.inputValue('[data-ov=words]') === 'Six Hundred and Eighty-Eight Thousand Naira Only.', 'reset amount in words to auto');
  await p.fill('[data-rt="0"]', '700000'); ok(await p.inputValue('[data-ov=total]') === '752,500.00', 'typed row total flows into VAT / total amount'); await p.click('[data-rreset="0"]');
  ok(await p.inputValue('[data-ov=total]') === '688,000.00', 'row total reset to auto');
  ok(await p.isChecked('[data-d=show_account]'), 'account details ticked by default'); ok((await p.textContent('#pages')).includes('ACCOUNT DETAILS'), 'account details shown in preview');
  await p.uncheck('[data-d=show_account]'); await p.waitForTimeout(150); const t0 = await p.textContent('#pages');
  ok(!t0.includes('ACCOUNT DETAILS') && !t0.includes('0153023517') && t0.includes('Amount in Words') && t0.includes('UBONG UDOH'), 'unticked: account details hidden, words and signature stay');
  await p.check('[data-d=show_account]'); await p.waitForTimeout(150); ok((await p.textContent('#pages')).includes('ACCOUNT DETAILS'), 'ticked again: shown');
  await p.screenshot({ path: OUT + '/pf-editor.png' });
  // ---- 15 rows: preview flows to page 2 with letterhead + repeated header ----
  ok((await p.textContent('#pages-n')).trim() === '1 page', 'one row = 1 page');
  for (let i = 0; i < 20; i++) { if (await p.$eval('#add', (e) => e.disabled)) break; await p.click('#add'); }
  ok(await p.locator('.row').count() === 15 && await p.$eval('#add', (e) => e.disabled), 'table capped at 15 rows');
  for (let i = 1; i < 15; i++) { await row(i, 'description', `Car hire day ${i + 1}: Port Harcourt to LGAs (round trip) with long descriptive text that wraps over several lines`); await row(i, 'note', 'Required; October 2026'); await row(i, 'unit_price', '160000'); }
  await p.waitForTimeout(300);
  const nPages = await p.locator('#pages .page').count(); ok(nPages >= 2, `15 rows flow onto page 2 (${nPages} pages)`);
  ok(await p.locator('#pages .page img.lh').count() === nPages, 'letterhead on every page');
  ok(await p.locator('#pages .page:nth-child(2) table.pf thead').count() === 1, 'table header repeats on page 2');
  ok((await p.textContent('#pages .page:last-child')).includes('ACCOUNT DETAILS') && (await p.textContent('#pages .page:last-child')).includes('UBONG UDOH'), 'closing block on the last page');
  const noClip = await p.evaluate(() => [...document.querySelectorAll('#pages .pbody')].every((b) => b.scrollHeight <= b.clientHeight + 1)); ok(noClip, 'nothing is clipped on any page');
  await p.screenshot({ path: OUT + '/pf-pages.png', fullPage: false });
  while (await p.locator('.row').count() > 1) await p.click('.row:last-child [data-rm]');
  await p.waitForTimeout(200);
  // ---- save, generate ----
  await p.click('#gen'); await p.waitForSelector('#result:not([hidden]) .badge.ok'); ok(genAuth === 'Bearer tok' && !!genBody.proforma_id, 'generate calls the API with the admin token');
  ok(p.url().includes('#/proforma/'), 'URL has the saved id'); const saved = await p.evaluate(() => window.__db.proformas[0]);
  ok(saved.details.show_account === true, 'setting saved with the document');
  ok(saved.total === 688000 && saved.vat === 48000 && saved.amount_words.startsWith('Six Hundred') && saved.rows.length === 1, 'saved totals and words stored');
  await p.uncheck('[data-d=show_account]'); await p.fill('[data-row="0"][data-rk=remarks]', 'Half Day'); ok((await p.textContent('#result')).includes('Out of date'), 'editing marks PDF out of date'); await p.click('#save'); await p.waitForTimeout(150);
  ok((await p.evaluate(() => window.__db.proformas[0].details.show_account)) === false, 'unticked choice saved');
  await p.click('text=← Dashboard'); await p.waitForSelector('.inv-row'); await p.click('.inv-row a.btn'); await p.waitForSelector('[data-d=show_account]'); await p.waitForTimeout(250);
  ok(!(await p.isChecked('[data-d=show_account]')) && !(await p.textContent('#pages')).includes('ACCOUNT DETAILS'), 'reopened document keeps account details hidden');
  // ---- dashboard ----
  await p.click('text=← Dashboard'); await p.waitForSelector('.inv-row'); ok((await p.textContent('.inv-row')).includes('CBM October 2026'), 'dashboard lists it with its label');
  await p.click('[data-a=dup]'); await p.waitForSelector('[data-k=ref_no]'); ok(await p.inputValue('[data-k=ref_no]') === '002', 'duplicate gets next reference 002');
  await p.fill('[data-k=ref_no]', '001'); await p.click('#save'); await p.waitForSelector('.toast.bad:has-text("already exists")', { timeout: 3000 }).then(() => ok(true, 'duplicate reference refused'), () => ok(false, 'duplicate reference refused'));
  await p.fill('[data-k=ref_no]', '002'); await p.fill('[data-k=label]', 'Second one'); await p.click('#save'); await p.waitForTimeout(200);
  await p.goto(B + '#/'); await p.waitForSelector('.inv-row'); ok(await p.locator('.inv-row').count() === 2, 'two documents listed');
  await p.fill('#q', 'okemesi'); ok(await p.locator('.inv-row').count() === 2, 'search by recipient'); await p.fill('#q', 'second'); ok(await p.locator('.inv-row').count() === 1, 'search by label'); await p.fill('#q', 'ikwere'); ok(await p.locator('.inv-row').count() === 2, 'search by description'); await p.fill('#q', '');
  await p.selectOption('#year', '2026'); await p.selectOption('#month', '10'); ok(await p.locator('.inv-row').count() === 1, 'month filter (October = the 26 Oct document)'); await p.selectOption('#month', '');
  await p.selectOption('#pdf', 'yes'); ok(await p.locator('.inv-row').count() === 1, 'filter: PDF ready'); await p.selectOption('#pdf', '');
  ok((await p.textContent('.tiles')).includes('All time'), 'stat tiles shown'); await p.screenshot({ path: OUT + '/pf-dashboard.png' });
  p.once('dialog', (d) => d.accept()); await p.click('.inv-row:nth-child(1) [data-a=del]'); await p.waitForTimeout(300); ok(await p.locator('.inv-row').count() === 1, 'delete removes the document');
  await p.click('text=Settings'); await p.waitForSelector('#f'); await p.fill('[name=bank]', 'Zenith'); await p.click('button[type=submit]'); await p.waitForSelector('.toast'); ok((await p.evaluate(() => window.__db.pf_settings[0].bank)) === 'Zenith', 'settings saved');
  await p.click('#signout'); await p.waitForSelector('#f'); ok(p.url().endsWith('#/login'), 'sign out returns to login');
  // ---- mobile ----
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 800 }); await stub(m);
  await m.goto(B); await m.fill('[name=email]', 'a@b.c'); await m.fill('[name=password]', 'secret'); await m.click('button[type=submit]'); await m.waitForSelector('.tiles');
  ok(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'mobile dashboard: no horizontal scroll');
  await m.goto(B + '#/proforma/new'); await m.waitForSelector('[data-k=ref_no]'); await m.waitForTimeout(300);
  ok(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'mobile editor: no horizontal scroll'); await m.screenshot({ path: OUT + '/pf-mobile.png', fullPage: true });
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close(); srv.kill(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})();
