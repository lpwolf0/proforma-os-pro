export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nl2br = (v) => esc(v).replace(/\r?\n/g, '<br>');
export const NAIRA = '₦';
export const MAX_ROWS = 15;

export const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
export const money2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (i) => MONTHS[i];
const ordinal = (d) => (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th'));
export const ymd = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
export const longDate = (iso) => { const p = ymd(iso); return p ? `${p.d}<sup>${ordinal(p.d)}</sup> ${MONTHS[p.m - 1]}, ${p.y}` : ''; };
export const shortDate = (iso) => { const p = ymd(iso); return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : ''; };

export const blankRow = () => ({ description: '', note: '', quantity: '', units: '1', unit_price: '', total: null, remarks: 'Full Day' });

/* ---- the same rules as the PDF engine on the server ---- */
const unitsOf = (r) => (r.units === null || r.units === undefined || String(r.units).trim() === '' ? 1 : num(r.units));
export const hasVal = (v) => v !== null && v !== undefined && v !== '';
export const rowTotal = (r) => (hasVal(r.total) ? num(r.total) : unitsOf(r) * num(r.unit_price));

export function totals(d) {
  const ov = d.overrides || {};
  const subtotal = d.rows.reduce((a, r) => a + rowTotal(r), 0);
  const vat = hasVal(ov.vat) ? num(ov.vat) : Math.round(subtotal * num(d.vat_rate)) / 100;
  const total = hasVal(ov.total) ? num(ov.total) : subtotal + vat;
  return { subtotal, vat, total };
}

/* ---- amount in words (kept identical to api/_engine/proforma.py) ---- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const below1000 = (n) => { const h = Math.floor(n / 100), r = n % 100, p = []; if (h) p.push(ONES[h] + ' Hundred'); if (r) { if (h) p.push('and'); p.push(below100(r)); } return p.join(' '); };
function intWords(n) {
  if (n === 0) return 'Zero';
  const g = []; while (n > 0) { g.push(n % 1000); n = Math.floor(n / 1000); }
  const parts = [];
  for (let i = g.length - 1; i >= 0; i--) { if (!g[i]) continue; let w = below1000(g[i]); if (i === 0 && g[i] < 100 && parts.length) w = 'and ' + w; parts.push((w + ' ' + SCALES[i]).trim()); }
  return parts.join(' ');
}
export function nairaWords(amount) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  if (cents >= 1e17) return '';
  const naira = Math.floor(cents / 100), kobo = cents % 100;
  return intWords(naira) + ' Naira' + (kobo ? ', ' + intWords(kobo) + ' Kobo' : '') + ' Only.';
}
export const wordsOf = (d) => (hasVal(d.overrides?.words) ? String(d.overrides.words) : nairaWords(totals(d).total));

export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts'); if (!box) return;
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; t.setAttribute('role', 'status');
  box.appendChild(t); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
