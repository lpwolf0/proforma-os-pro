import { supa } from '../supa.js';
import { $, esc, NAIRA, money0, shortDate, ymd, monthName, todayISO, toast } from '../util.js';
import { downloadPdf, pdfLink, copyText } from '../files.js';

const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
const firstLine = (s) => String(s || '').split(/\r?\n/).find((x) => x.trim()) || '';

export async function render(el) {
  const { data, error } = await supa.from('proformas')
    .select('id,ref_no,label,doc_date,recipient,rows,total,pdf_path,pdf_generated_at,updated_at')
    .order('doc_date', { ascending: false }).order('ref_no', { ascending: false }).limit(3000);
  if (error) throw new Error('Could not load documents. Did you run the SQL migration?');
  let all = data || [];
  const now = new Date();
  const f = { q: '', year: String(now.getFullYear()), month: '', pdf: '' };

  el.innerHTML = `<div class="wrap">
    <div class="head"><h1>Dashboard</h1><a class="btn btn-primary" href="#/proforma/new">+ New proforma</a></div>
    <div class="tiles" id="tiles"></div>
    <div class="card chart"><div class="card-head"><h2 id="chart-title">Per month</h2><span class="muted small">Click a bar to filter by month</span></div><div class="bars" id="bars" role="list"></div></div>
    <div class="card">
      <div class="filters">
        <label class="field grow"><span class="label">Search</span><input class="input" id="q" type="search" placeholder="Reference, label, recipient, description…" autocomplete="off"></label>
        <label class="field"><span class="label">Year</span><select class="input" id="year"></select></label>
        <label class="field"><span class="label">Month</span><select class="input" id="month"><option value="">All months</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${monthName(i)}</option>`).join('')}</select></label>
        <label class="field"><span class="label">PDF</span><select class="input" id="pdf"><option value="">All</option><option value="yes">PDF ready</option><option value="no">No PDF yet</option></select></label>
      </div>
      <p class="muted small" id="summary" aria-live="polite"></p><div id="list"></div>
    </div></div>`;

  const years = [...new Set(all.map((i) => ymd(i.doc_date)?.y).filter(Boolean).concat(now.getFullYear()))].sort((a, b) => b - a);
  $('#year').innerHTML = '<option value="">All years</option>' + years.map((y) => `<option ${String(y) === f.year ? 'selected' : ''}>${y}</option>`).join('');
  const sum = (a) => a.reduce((s, i) => s + Number(i.total || 0), 0);

  function drawTiles() {
    const cm = all.filter((i) => { const p = ymd(i.doc_date); return p && p.y === now.getFullYear() && p.m === now.getMonth() + 1; });
    const cy = all.filter((i) => ymd(i.doc_date)?.y === now.getFullYear());
    const noPdf = all.filter((i) => !i.pdf_path).length;
    $('#tiles').innerHTML = [
      [`${monthName(now.getMonth())} ${now.getFullYear()}`, NAIRA + money0(sum(cm)), `${cm.length} document${cm.length === 1 ? '' : 's'}`],
      [`Year ${now.getFullYear()}`, NAIRA + money0(sum(cy)), `${cy.length} document${cy.length === 1 ? '' : 's'}`],
      ['All time', NAIRA + money0(sum(all)), `${all.length} document${all.length === 1 ? '' : 's'}`],
      ['Without a PDF', String(noPdf), noPdf ? 'open them and generate' : 'all documents have a PDF'],
    ].map(([l, v, s]) => `<div class="tile"><div class="label">${esc(l)}</div><div class="big-num">${esc(v)}</div><div class="muted small">${esc(s)}</div></div>`).join('');
  }
  function drawBars() {
    const y = +(f.year || now.getFullYear()); $('#chart-title').textContent = `Total amount per month, ${y}`;
    const sums = Array(12).fill(0); all.forEach((i) => { const p = ymd(i.doc_date); if (p && p.y === y) sums[p.m - 1] += Number(i.total || 0); });
    const max = Math.max(...sums, 1);
    $('#bars').innerHTML = sums.map((v, i) => `<button type="button" class="bar ${String(i + 1) === f.month ? 'on' : ''}" role="listitem" data-m="${i + 1}" aria-label="${monthName(i)}: ${NAIRA}${money0(v)}" title="${monthName(i)}: ${NAIRA}${money0(v)}">
      <span class="bar-val">${v ? short(v) : ''}</span><span class="bar-fill" style="height:${Math.max(v ? 4 : 1, (v / max) * 100)}%"></span><span class="bar-lbl">${monthName(i).slice(0, 3)}</span></button>`).join('');
  }
  function filtered() {
    const q = f.q.trim().toLowerCase();
    return all.filter((i) => {
      const p = ymd(i.doc_date);
      if (f.year && (!p || p.y !== +f.year)) return false; if (f.month && (!p || p.m !== +f.month)) return false;
      if (f.pdf === 'yes' && !i.pdf_path) return false; if (f.pdf === 'no' && i.pdf_path) return false;
      if (!q) return true;
      const hay = [i.ref_no, i.label, i.recipient, ...(i.rows || []).flatMap((r) => [r.description, r.note, r.quantity, r.remarks])].join(' ').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }
  function drawList() {
    const rows = filtered();
    $('#summary').textContent = `${rows.length} document${rows.length === 1 ? '' : 's'} · ${NAIRA}${money0(sum(rows))} total amount`;
    if (!rows.length) { $('#list').innerHTML = `<div class="empty">${all.length ? 'Nothing matches these filters.' : 'No proformas yet. Create your first one.'}</div>`; return; }
    $('#list').innerHTML = `<div class="inv-list">${rows.map((i) => {
      const stale = i.pdf_path && i.pdf_generated_at && new Date(i.updated_at) - new Date(i.pdf_generated_at) > 5000; const n = (i.rows || []).length;
      const first = String((i.rows || [])[0]?.description || '').split(/\r?\n/)[0];
      return `<article class="inv-row" data-id="${i.id}">
        <div class="c-no"><a href="#/proforma/${i.id}"><b>${esc(i.ref_no)}</b></a><span class="muted small">${esc(shortDate(i.doc_date))}</span></div>
        <div class="c-info"><div>${esc(i.label || firstLine(i.recipient) || '—')}</div><div class="muted small">${esc(first.slice(0, 80))}${first.length > 80 ? '…' : ''} · ${n} row${n === 1 ? '' : 's'}</div></div>
        <div class="c-amt"><b>${NAIRA}${money0(i.total)}</b><span class="badge ${!i.pdf_path || stale ? 'warn' : 'ok'}">${!i.pdf_path ? 'No PDF' : stale ? 'PDF outdated' : 'PDF ready'}</span></div>
        <div class="c-act"><a class="btn sm" href="#/proforma/${i.id}">Open</a>
          <button class="btn sm" data-a="dl" ${i.pdf_path ? '' : 'disabled'}>Download</button><button class="btn sm" data-a="link" ${i.pdf_path ? '' : 'disabled'}>Copy link</button>
          <button class="btn sm" data-a="dup">Duplicate</button><button class="btn sm danger" data-a="del">Delete</button></div></article>`;
    }).join('')}</div>`;
  }
  const redraw = () => { drawBars(); drawList(); };
  drawTiles(); redraw();

  const onInput = (e) => {
    const id = e.target.id; if (id === 'q') f.q = e.target.value; else if (id === 'year') f.year = e.target.value; else if (id === 'month') f.month = e.target.value; else if (id === 'pdf') f.pdf = e.target.value; else return;
    redraw();
  };
  el.addEventListener('input', onInput); el.addEventListener('change', onInput);
  el.addEventListener('click', async (e) => {
    const bar = e.target.closest('.bar');
    if (bar) { f.month = f.month === bar.dataset.m ? '' : bar.dataset.m; $('#month').value = f.month; return redraw(); }
    const btn = e.target.closest('[data-a]'); if (!btn) return;
    const id = btn.closest('.inv-row').dataset.id, p = all.find((x) => x.id === id); btn.disabled = true;
    try {
      if (btn.dataset.a === 'dl') await downloadPdf(p.pdf_path, p);
      else if (btn.dataset.a === 'link') { if (await copyText(await pdfLink(p.pdf_path, p))) toast('Download link copied (valid for 1 year)'); }
      else if (btn.dataset.a === 'dup') await duplicate(id);
      else if (btn.dataset.a === 'del') {
        if (!confirm(`Delete proforma ${p.ref_no}${p.label ? ' (' + p.label + ')' : ''}? Its PDF is removed too. This cannot be undone.`)) return;
        await remove(p); all = all.filter((x) => x.id !== id); drawTiles(); redraw(); toast('Deleted');
      }
    } catch (err) { toast(err.message || 'Action failed', 'bad'); }
    finally { btn.disabled = btn.dataset.a === 'dl' || btn.dataset.a === 'link' ? !p.pdf_path : false; }
  });
}

async function duplicate(id) {
  const { data: src, error } = await supa.from('proformas').select('*').eq('id', id).single(); if (error) throw new Error('Could not read the document');
  const { data: no, error: e2 } = await supa.rpc('next_pf_ref'); if (e2) throw new Error('Could not get the next reference');
  const { data: c, error: e3 } = await supa.from('proformas').insert({ ref_no: no, label: src.label, doc_date: todayISO(), recipient: src.recipient, vat_rate: src.vat_rate, rows: src.rows,
    overrides: src.overrides, amount_words: src.amount_words, details: src.details, subtotal: src.subtotal, vat: src.vat, total: src.total }).select('id').single();
  if (e3) throw new Error('Could not duplicate the document');
  toast(`Duplicated as ${no}`); location.hash = `#/proforma/${c.id}`;
}
async function remove(p) {
  const { data: files } = await supa.storage.from('proforma-pdfs').list(p.id, { limit: 1000 });
  if (files?.length) await supa.storage.from('proforma-pdfs').remove(files.map((x) => `${p.id}/${x.name}`));
  const { error } = await supa.from('proformas').delete().eq('id', p.id); if (error) throw new Error('Could not delete the document');
}
