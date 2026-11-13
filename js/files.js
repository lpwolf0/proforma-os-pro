import { supa, LINK_SECONDS } from './supa.js';

const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
export const pdfName = (p) => ['Proforma', safe(p.ref_no), safe(p.label)].filter(Boolean).join('-') + '.pdf';

// A fresh long-lived (1 year) link to a stored PDF; `download` names the saved file.
export async function pdfLink(path, p) {
  const { data, error } = await supa.storage.from('proforma-pdfs').createSignedUrl(path, LINK_SECONDS, { download: pdfName(p) });
  if (error) throw new Error('Could not create the download link');
  return data.signedUrl;
}
export async function downloadPdf(path, p) {
  const a = document.createElement('a'); a.href = await pdfLink(path, p); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { window.prompt('Copy this link:', text); return false; }
}
