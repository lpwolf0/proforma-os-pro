import { esc, nl2br, money0, num, longDate, rowTotal, totals, wordsOf } from './util.js';

const PAGE_H = 1123;

/* One A4 page = letterhead + a body area. Rows are added one at a time and moved to a new page (with the
   letterhead and table header repeated) as soon as they no longer fit. This mirrors the PDF engine, whose
   page breaks are the final word: fonts differ slightly between this preview and the PDF. */
export function paginate(container, d) {
  container.innerHTML = '';
  const dt = d.details || {};
  const t = totals(d);
  const vr = esc(String(num(d.vat_rate)));

  const newPage = () => {
    const page = document.createElement('div'); page.className = 'page';
    page.innerHTML = '<img class="lh" src="assets/letterhead.jpg" alt="Perfect Hand Integrated Services letterhead"><div class="pbody"></div>';
    container.appendChild(page); return page.querySelector('.pbody');
  };
  const over = (body) => body.scrollHeight > body.clientHeight + 0.5;

  const rowHTML = (r, i) => `<tr class="item"><td class="c">${i + 1}</td>
      <td>${nl2br(r.description)}${String(r.note || '').trim() ? `<div class="note">${nl2br(r.note)}</div>` : ''}</td>
      <td class="qty">${nl2br(r.quantity)}</td><td class="r">${String(r.unit_price ?? '').trim() ? money0(num(r.unit_price)) : ''}</td>
      <td class="r">${money0(rowTotal(r))}</td><td class="c">${nl2br(r.remarks)}</td></tr>`;
  const vatTr = `<tr class="sumrow"><td></td><td></td><td></td><td class="lbl">${vr}% VAT</td><td class="r">${money0(t.vat)}</td><td class="c">----------</td></tr>`;
  const totTr = `<tr class="sumrow"><td></td><td></td><td></td><td class="lbl">Total Amount</td><td class="r">${money0(t.total)}</td><td class="c">----------</td></tr>`;

  const makeTable = () => {
    const tb = document.createElement('table'); tb.className = 'pf';
    tb.innerHTML = '<colgroup><col style="width:4.3%"><col style="width:41%"><col style="width:13.4%"><col style="width:12.5%"><col style="width:15.8%"><col style="width:13%"></colgroup><thead><tr><th>S/N</th><th>DESCRIPTION</th><th>QUANTITY</th><th>UNIT PRICE</th><th>TOTAL PRICE</th><th>REMARKS</th></tr></thead><tbody></tbody>';
    return tb;
  };

  let body = newPage();
  body.insertAdjacentHTML('beforeend', `<p class="pf-date">${longDate(d.doc_date)}</p><div class="pf-recipient">${nl2br(d.recipient)}</div><div class="pf-title">${esc(dt.doc_title || 'INVOICE')}</div>`);
  let table = makeTable(); body.appendChild(table); let tbody = table.tBodies[0];

  // a group of <tr> is placed as a unit; if it does not fit it starts a fresh page (unless the page is still empty)
  const place = (htmls) => {
    const els = htmls.map((h) => { const x = document.createElement('tbody'); x.innerHTML = h; return x.firstElementChild; });
    els.forEach((el) => tbody.appendChild(el));
    if (over(body) && tbody.children.length > els.length) {
      els.forEach((el) => el.remove());
      body = newPage(); table = makeTable(); body.appendChild(table); tbody = table.tBodies[0];
      els.forEach((el) => tbody.appendChild(el));
    }
  };
  const n = d.rows.length;
  d.rows.slice(0, n - 1).forEach((r, i) => place([rowHTML(r, i)]));
  place([rowHTML(d.rows[n - 1], n - 1), vatTr, totTr]);                 // last item + VAT + total stay together

  // closing block: amount in words, account details, signature
  const sig = dt.show_signature ? '<img class="sig" src="assets/signature.png" alt="">' : '<div style="height:36px"></div>';
  const closing = document.createElement('div'); closing.className = 'closing';
  closing.innerHTML = `<p class="words"><b>Amount in Words:</b> ${esc(wordsOf(d)) || '<span style="color:#999">…</span>'}</p>
    ${dt.show_account === false ? '' : `<p class="accd"><b>ACCOUNT DETAILS:</b></p>
    <table class="acc"><tr><td><b>ACCOUNT NAME:</b></td><td>${esc(dt.account_name)}</td></tr><tr><td><b>Bank:</b></td><td>${esc(dt.bank)}</td></tr>
    <tr><td><b>Account Number:</b></td><td>${esc(dt.account_no)}</td></tr><tr><td><b>TIN Number:</b></td><td>${esc(dt.tin)}</td></tr></table>`}
    <div class="signoff">${sig}<div><b>${esc(String(dt.signatory || '').toUpperCase())}</b></div><div>(${esc(dt.title)})</div><div><b>For:</b> ${esc(dt.sign_for)}</div></div>`;
  body.appendChild(closing);
  if (over(body)) { closing.remove(); body = newPage(); body.appendChild(closing); }
  return container.children.length;
}

export function fitPreview(stage) {
  const sc = stage.firstElementChild; if (!sc) return;
  const k = Math.min(1, stage.clientWidth / 794);
  sc.style.transform = `scale(${k})`;
  stage.style.height = Math.ceil(sc.offsetHeight * k) + 'px';
}
