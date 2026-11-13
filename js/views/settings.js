import { supa } from '../supa.js';
import { $, esc, toast } from '../util.js';

const FIELDS = [['account_name', 'Account name'], ['bank', 'Bank'], ['account_no', 'Account number'], ['tin', 'TIN number'], ['signatory', 'Signatory'],
  ['title', 'Signatory title'], ['sign_for', '“For:” line'], ['doc_title', 'Document heading'], ['vat_rate', 'VAT rate (%)']];

export async function render(el) {
  const { data: s, error } = await supa.from('pf_settings').select('*').single();
  if (error) throw new Error('Could not load settings. Did you run the SQL migration?');
  el.innerHTML = `<div class="wrap narrowpage"><div class="head"><h1>Settings</h1></div>
    <form class="card" id="f"><p class="muted">Defaults for every new proforma. Documents you already saved keep their own details.</p>
      <div class="grid2">${FIELDS.map(([k, l]) => `<label class="field"><span class="label">${l}</span><input class="input" name="${k}" value="${esc(s[k])}"></label>`).join('')}</div>
      <label class="field mt"><span class="label">Default recipient</span><textarea class="input" name="recipient" rows="4">${esc(s.recipient)}</textarea></label>
      <label class="check"><input type="checkbox" name="show_signature" ${s.show_signature ? 'checked' : ''}> Show signature image by default</label>
      <div class="btnrow mt"><button class="btn btn-primary" type="submit">Save settings</button></div></form></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; const patch = { show_signature: f.show_signature.checked, recipient: f.recipient.value };
    FIELDS.forEach(([k]) => { patch[k] = f[k].value.trim(); });
    patch.vat_rate = parseFloat(patch.vat_rate);
    if (!(patch.vat_rate >= 0 && patch.vat_rate <= 100)) return toast('VAT rate must be between 0 and 100', 'bad');
    const { error: er } = await supa.from('pf_settings').update(patch).eq('id', true);
    toast(er ? 'Could not save settings' : 'Settings saved', er ? 'bad' : 'ok');
  });
}
