import { supa } from '../supa.js';
import { $, $$, esc, NAIRA, MAX_ROWS, num, money2, rowTotal, totals, blankRow, todayISO, hasVal, nairaWords, wordsOf, toast } from '../util.js';
import { paginate, fitPreview } from '../preview.js';
import { downloadPdf, pdfLink, copyText } from '../files.js';

const detailsFrom = (s) => ({ account_name: s.account_name, bank: s.bank, account_no: s.account_no, tin: s.tin, signatory: s.signatory, title: s.title,
  sign_for: s.sign_for, doc_title: s.doc_title, show_signature: s.show_signature, show_account: true });

export async function render(el, ctx, { id }) {
  const { data: settings, error: se } = await supa.from('pf_settings').select('*').single();
  if (se) throw new Error('Could not load settings. Did you run the SQL migration?');

  let doc, dirty = false, stale = false, busy = false;
  const cleanOv = (o) => ({ vat: null, total: null, words: null, ...(o || {}) });
  if (id === 'new') {
    const { data: no, error } = await supa.rpc('next_pf_ref'); if (error) throw new Error('Could not get the next reference');
    doc = { id: null, ref_no: no, label: '', doc_date: todayISO(), recipient: settings.recipient, vat_rate: String(settings.vat_rate), rows: [blankRow()],
      overrides: cleanOv(), details: detailsFrom(settings), pdf_path: null, pdf_generated_at: null, updated_at: null };
    dirty = true;
  } else {
    const { data, error } = await supa.from('proformas').select('*').eq('id', id).maybeSingle();
    if (error || !data) { el.innerHTML = '<div class="wrap"><div class="card pad"><h2>Not found</h2><a class="btn" href="#/">Back to dashboard</a></div></div>'; return; }
    doc = { ...data, vat_rate: String(data.vat_rate), rows: data.rows.map((r) => ({ ...blankRow(), ...r })), overrides: cleanOv(data.overrides), details: { ...detailsFrom(settings), ...(data.details || {}) } };
    stale = !!doc.pdf_path && new Date(doc.updated_at) - new Date(doc.pdf_generated_at) > 5000;
  }

  el.innerHTML = `<div class="wrap editor-grid">
    <section class="editor" aria-label="Proforma editor">
      <div class="head"><h1 id="h1"></h1><a class="btn" href="#/">← Dashboard</a></div>

      <div class="card"><h2><span class="step">1</span> Recipient &amp; date</h2>
        <label class="field"><span class="label">The Procurement Officer… (name and address)</span><textarea class="input" rows="4" data-k="recipient"></textarea></label>
        <div class="grid2">
          <label class="field"><span class="label">Date</span><input class="input" type="date" data-k="doc_date"></label>
          <label class="field"><span class="label">Label <small class="muted">(not printed)</small></span><input class="input" data-k="label" placeholder="e.g. CBM October 2026" autocomplete="off"></label>
        </div>
        <label class="field mt"><span class="label">Reference <small class="muted">(not printed, automatic)</small></span><input class="input" data-k="ref_no" autocomplete="off"></label>
      </div>

      <div class="card"><div class="card-head"><h2><span class="step">2</span> Table</h2><span class="muted small" id="row-count"></span></div>
        <div id="rows"></div><button class="btn dashed wide" id="add" type="button">+ Add row</button></div>

      <div class="card"><h2><span class="step">3</span> Totals &amp; amount in words</h2>
        <p class="hint top">Calculated from the table. Type over any figure to override it.</p>
        <div class="grid2">
          <label class="field"><span class="label">VAT <input class="rate" inputmode="decimal" data-k="vat_rate" aria-label="VAT rate percent">%</span><input class="input num" inputmode="decimal" data-ov="vat" autocomplete="off"><button class="auto" type="button" data-reset="vat">Reset to auto</button></label>
          <label class="field"><span class="label">Total amount (${NAIRA})</span><input class="input num" inputmode="decimal" data-ov="total" autocomplete="off"><button class="auto" type="button" data-reset="total">Reset to auto</button></label>
        </div>
        <label class="field mt"><span class="label">Amount in words</span><textarea class="input" rows="2" data-ov="words"></textarea><button class="auto" type="button" data-reset="words">Reset to auto</button></label>
      </div>

      <div class="card"><label class="check first"><input type="checkbox" data-d="show_account"> <span><b>Show account details</b> on the document<br><span class="muted small">Account name, bank, account number and TIN. Untick to leave the whole section out.</span></span></label></div>

      <details class="card"><summary>Account details &amp; signature <small class="muted">(defaults come from Settings)</small></summary>
        <div class="grid2 mt">
          ${[['account_name', 'Account name'], ['bank', 'Bank'], ['account_no', 'Account number'], ['tin', 'TIN number'], ['signatory', 'Signatory'], ['title', 'Signatory title'], ['sign_for', '“For:” line'], ['doc_title', 'Document heading']]
            .map(([k, l]) => `<label class="field"><span class="label">${l}</span><input class="input" data-d="${k}"></label>`).join('')}
        </div>
        <label class="check"><input type="checkbox" data-d="show_signature"> Show signature image</label></details>

      <div class="card" id="result" hidden></div>
      <div class="actionbar"><span class="muted small" id="state" aria-live="polite"></span>
        <button class="btn" id="save" type="button">Save</button><button class="btn btn-primary" id="gen" type="button">Save &amp; generate PDF</button></div>
    </section>

    <section class="preview" aria-label="Live preview"><div class="muted small pv-label">Live preview · A4 · <span id="pages-n"></span></div>
      <div class="stage" id="stage"><div class="scaler" id="pages"></div></div>
      <p class="muted small">Page breaks in the preview are close to the PDF but the PDF is the final word.</p></section>
  </div>`;

  /* ---------- rendering ---------- */
  const rowHTML = (r, i) => {
    const f = (k, label, cls, attrs = '') => `<label class="field ${cls}"><span class="label">${label}</span><input class="input" data-row="${i}" data-rk="${k}" value="${esc(r[k])}" ${attrs} autocomplete="off"></label>`;
    return `<div class="row" data-i="${i}"><div class="row-head"><span>Row ${i + 1}</span>${doc.rows.length > 1 ? `<button class="rm" type="button" data-rm="${i}" aria-label="Remove row ${i + 1}">Remove</button>` : ''}</div>
      <div class="rgrid">
        <label class="field c6"><span class="label">Description</span><textarea class="input" rows="3" data-row="${i}" data-rk="description">${esc(r.description)}</textarea></label>
        ${f('note', 'Bold line under the description', 'c6', 'placeholder="Required; 28th and 29th October 2026"')}
        <label class="field c3"><span class="label">Quantity</span><textarea class="input" rows="2" data-row="${i}" data-rk="quantity" placeholder="2 cars to visit 2 LGAs daily">${esc(r.quantity)}</textarea></label>
        ${f('remarks', 'Remarks', 'c3', 'list="remarks"')}
        ${f('units', 'Units × unit price', 'c2', 'inputmode="decimal"')}${f('unit_price', 'Unit price (' + NAIRA + ')', 'c2', 'inputmode="decimal"')}
        <label class="field c2"><span class="label">Total price</span><input class="input num" inputmode="decimal" data-rt="${i}" autocomplete="off"><button class="auto" type="button" data-rreset="${i}">Auto</button></label>
      </div></div>`;
  };
  function drawRows() {
    $('#rows').innerHTML = doc.rows.map(rowHTML).join('');
    const n = doc.rows.length; $('#row-count').textContent = `${n} of ${MAX_ROWS} rows`;
    const add = $('#add'); add.disabled = n >= MAX_ROWS; add.textContent = n >= MAX_ROWS ? `Maximum of ${MAX_ROWS} rows reached` : '+ Add row';
    syncRowTotals();
  }
  function syncRowTotals(skip) {
    $$('[data-rt]').forEach((x) => { const r = doc.rows[+x.dataset.rt]; if (x !== skip) x.value = money2(rowTotal(r)); const b = $(`[data-rreset="${x.dataset.rt}"]`); if (b) b.classList.toggle('on', hasVal(r.total)); });
  }
  function syncFields() {
    $$('[data-k]').forEach((x) => { const v = doc[x.dataset.k]; if (x.value !== String(v ?? '')) x.value = v ?? ''; });
    $$('[data-d]').forEach((x) => { const v = doc.details[x.dataset.d]; if (x.type === 'checkbox') x.checked = !!v; else if (x.value !== String(v ?? '')) x.value = v ?? ''; });
    syncTotals();
  }
  function syncTotals(skip) {
    const t = totals(doc);
    $$('[data-ov]').forEach((x) => {
      const k = x.dataset.ov;
      if (x !== skip) x.value = k === 'words' ? wordsOf(doc) : money2(t[k]);
      const b = $(`[data-reset="${k}"]`); if (b) b.classList.toggle('on', hasVal(doc.overrides[k]));
    });
    syncRowTotals(skip);
  }
  function drawState() {
    $('#h1').textContent = doc.id ? `Proforma ${doc.ref_no}${doc.label ? ' · ' + doc.label : ''}` : 'New proforma';
    $('#state').textContent = busy ? 'Working…' : dirty ? 'Unsaved changes' : stale ? 'Saved · PDF is out of date' : doc.pdf_path ? 'Saved · PDF is up to date' : 'Saved';
    $('#save').disabled = busy || !dirty; $('#gen').disabled = busy;
    const r = $('#result');
    if (doc.pdf_path) {
      r.hidden = false;
      r.innerHTML = `<h2>PDF</h2><p>${stale || dirty ? '<span class="badge warn">Out of date</span> Generate again to include your latest changes.' : '<span class="badge ok">Ready</span> The PDF is stored privately.'}</p>
        <div class="btnrow"><button class="btn btn-primary" data-r="dl">Download PDF</button><button class="btn" data-r="copy">Copy download link</button></div>
        <p class="muted small">The link stays valid for 1 year. Anyone who has it can open the PDF, so share it carefully.</p>`;
    } else r.hidden = true;
  }
  let raf = 0;
  const preview = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const n = paginate($('#pages'), doc); $('#pages-n').textContent = n + (n === 1 ? ' page' : ' pages'); fitPreview($('#stage')); }); };
  const touch = (skip) => { dirty = true; syncTotals(skip); drawState(); preview(); };

  drawRows(); syncFields(); drawState();
  const first = () => { const n = paginate($('#pages'), doc); $('#pages-n').textContent = n + (n === 1 ? ' page' : ' pages'); fitPreview($('#stage')); };
  first(); if (document.fonts?.ready) document.fonts.ready.then(first);

  /* ---------- save / generate ---------- */
  const r2 = (n) => Math.round(n * 100) / 100;
  async function save() {
    const no = String(doc.ref_no || '').trim();
    if (!no) throw new Error('Enter a reference'); if (!doc.doc_date) throw new Error('Choose the date');
    const t = totals(doc);
    const payload = { ref_no: no, label: doc.label.trim(), doc_date: doc.doc_date, recipient: doc.recipient, vat_rate: num(doc.vat_rate),
      rows: doc.rows.map((r) => ({ description: r.description, note: r.note, quantity: r.quantity, units: String(r.units ?? ''), unit_price: String(r.unit_price ?? ''), total: hasVal(r.total) ? String(r.total) : null, remarks: r.remarks })),
      overrides: Object.fromEntries(Object.entries(doc.overrides).filter(([, v]) => hasVal(v))), amount_words: wordsOf(doc), details: doc.details,
      subtotal: r2(t.subtotal), vat: r2(t.vat), total: r2(t.total) };
    const q = doc.id ? supa.from('proformas').update(payload).eq('id', doc.id).select('id,updated_at').single() : supa.from('proformas').insert(payload).select('id,updated_at').single();
    const { data, error } = await q;
    if (error) throw new Error(error.code === '23505' ? `Reference ${no} already exists. Choose another.` : 'Could not save. Check your connection and try again.');
    const firstSave = !doc.id; doc.id = data.id; doc.updated_at = data.updated_at; doc.ref_no = no; dirty = false; if (doc.pdf_path) stale = true;
    if (firstSave) history.replaceState(null, '', `#/proforma/${doc.id}`);
  }
  const run = async (fn) => { if (busy) return; busy = true; drawState(); try { await fn(); } catch (e) { toast(e.message || 'Something went wrong', 'bad'); } finally { busy = false; drawState(); } };

  $('#save').addEventListener('click', () => run(async () => { await save(); toast('Saved'); }));
  $('#gen').addEventListener('click', () => run(async () => {
    if (totals(doc).total <= 0 && !confirm('The total amount is 0. Generate the PDF anyway?')) return;
    if (dirty || !doc.id) await save();
    const { data: { session } } = await supa.auth.getSession();
    const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ proforma_id: doc.id }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'The PDF could not be generated');
    doc.pdf_path = j.path; doc.pdf_generated_at = new Date().toISOString(); stale = false;
    toast('PDF ready'); $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));

  /* ---------- events ---------- */
  const onInput = (e) => {
    const x = e.target;
    if (x.dataset.k) { doc[x.dataset.k] = x.value; return touch(); }
    if (x.dataset.d) { doc.details[x.dataset.d] = x.type === 'checkbox' ? x.checked : x.value; return touch(); }
    if (x.dataset.row !== undefined) { doc.rows[+x.dataset.row][x.dataset.rk] = x.value; return touch(); }
    if (x.dataset.rt !== undefined) { doc.rows[+x.dataset.rt].total = x.value.trim() === '' ? null : x.value; return touch(x); }
    if (x.dataset.ov) { doc.overrides[x.dataset.ov] = x.value.trim() === '' ? null : x.value; return touch(x); }
  };
  const onClick = (e) => {
    const t = e.target;
    const rm = t.closest('[data-rm]'); if (rm) { doc.rows.splice(+rm.dataset.rm, 1); drawRows(); return touch(); }
    const rr = t.closest('[data-rreset]'); if (rr) { doc.rows[+rr.dataset.rreset].total = null; return touch(); }
    const rs = t.closest('[data-reset]'); if (rs) { doc.overrides[rs.dataset.reset] = null; return touch(); }
    if (t.closest('#add')) {
      if (doc.rows.length >= MAX_ROWS) return;
      const last = doc.rows[doc.rows.length - 1], n = blankRow(); if (last) { n.remarks = last.remarks; n.quantity = last.quantity; }
      doc.rows.push(n); drawRows(); touch(); const ta = $$('.row:last-child textarea')[0]; if (ta) ta.focus(); return;
    }
    const rb = t.closest('[data-r]');
    if (rb) return run(async () => { if (rb.dataset.r === 'dl') await downloadPdf(doc.pdf_path, doc); else if (await copyText(await pdfLink(doc.pdf_path, doc))) toast('Download link copied (valid for 1 year)'); });
  };
  const onFocusOut = (e) => { if (e.target.dataset?.ov || e.target.dataset?.rt !== undefined) syncTotals(); };
  const onResize = () => fitPreview($('#stage'));
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  el.addEventListener('input', onInput); el.addEventListener('change', (e) => { if (e.target.type === 'checkbox') onInput(e); });
  el.addEventListener('click', onClick); el.addEventListener('focusout', onFocusOut);
  window.addEventListener('resize', onResize); window.addEventListener('beforeunload', onUnload);
  const dl = document.createElement('datalist'); dl.id = 'remarks'; dl.innerHTML = '<option>Full Day</option><option>Half Day</option><option>Hourly</option><option>----------</option>'; el.appendChild(dl);
  return () => { window.removeEventListener('resize', onResize); window.removeEventListener('beforeunload', onUnload); cancelAnimationFrame(raf); };
}
