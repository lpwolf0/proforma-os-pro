// In-memory stand-in for @supabase/supabase-js, used only by the UI test.
const db = { proformas: [], pf_settings: [{ id: true, account_name: 'Perfect Hand Integrated Service.', bank: 'GTB', account_no: '0153023517', tin: '18234768', signatory: 'UBONG UDOH', title: 'Manager', sign_for: 'Perfect Hand Transport Services.', doc_title: 'INVOICE', recipient: 'The Procurement Officer,\nCBM Country Coordination Office,\n13 Okemesi Crescent, Off Twon Brass Street, Garki 2,\nAbuja, Nigeria.', vat_rate: 7.5, show_signature: true }], admin_profile: [{ user_id: 'u1' }] };
const files = new Map(); let session = JSON.parse(localStorage.getItem('fake-session') || 'null'); const listeners = [];
window.__db = db; window.__files = files;
const uid = () => crypto.randomUUID();
function builder(table) {
  const q = { f: [], op: 'select', order: [], one: null, patch: null, lim: null };
  const api = {
    select() { return api; }, eq(k, v) { q.f.push([k, v]); return api; }, order(k, o) { q.order.push([k, o?.ascending !== false]); return api; }, limit(n) { q.lim = n; return api; },
    single() { q.one = 'single'; return api; }, maybeSingle() { q.one = 'maybe'; return api; },
    insert(r) { q.op = 'insert'; q.patch = r; return api; }, update(p) { q.op = 'update'; q.patch = p; return api; }, delete() { q.op = 'delete'; return api; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  function run() {
    const rows = db[table]; const match = (r) => q.f.every(([k, v]) => r[k] === v);
    if (q.op === 'insert') {
      const row = { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), pdf_path: null, pdf_generated_at: null, ...q.patch };
      if (table === 'proformas' && rows.some((r) => r.ref_no.toLowerCase() === row.ref_no.toLowerCase())) return { data: null, error: { code: '23505' } };
      if (table === 'proformas' && !(row.rows.length >= 1 && row.rows.length <= 15)) return { data: null, error: { code: '23514' } };
      rows.push(row); return { data: q.one ? row : [row], error: null };
    }
    if (q.op === 'update') { const hit = rows.filter(match);
      if (table === 'proformas' && q.patch.ref_no && rows.some((r) => r.id !== hit[0]?.id && r.ref_no.toLowerCase() === q.patch.ref_no.toLowerCase())) return { data: null, error: { code: '23505' } }; hit.forEach((r) => Object.assign(r, q.patch, { updated_at: new Date().toISOString() })); return { data: q.one ? hit[0] : hit, error: null }; }
    if (q.op === 'delete') { db[table] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
    let out = rows.filter(match);
    q.order.forEach(([k, asc]) => out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)));
    if (q.lim) out = out.slice(0, q.lim);
    if (q.one === 'single') return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'none' } };
    if (q.one === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  return api;
}
export const createClient = () => ({
  auth: {
    getSession: async () => ({ data: { session } }),
    signInWithPassword: async ({ email, password }) => { if (password !== 'secret') return { error: { message: 'bad' } }; session = { access_token: 'tok', user: { id: 'u1', email } }; localStorage.setItem('fake-session', JSON.stringify(session)); return { data: { session }, error: null }; },
    signOut: async () => { session = null; localStorage.removeItem('fake-session'); listeners.forEach((l) => l('SIGNED_OUT')); return { error: null }; },
    onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: {} } }; },
  },
  from: builder,
  rpc: async (name) => { const n = Math.max(0, ...db.proformas.map((i) => (/^\d+$/.test(i.ref_no) ? +i.ref_no : 0))) + 1; return { data: String(n).padStart(3, '0'), error: null }; },
  storage: { from: (bucket) => ({
    upload: async (path, file) => { files.set(bucket + '/' + path, file); return { data: {}, error: null }; },
    remove: async (paths) => { paths.forEach((p) => files.delete(bucket + '/' + p)); return { data: [], error: null }; },
    list: async (folder) => ({ data: [...files.keys()].filter((k) => k.startsWith(bucket + '/' + folder + '/')).map((k) => ({ name: k.split('/').pop() })), error: null }),
    createSignedUrl: async (p, exp, opt) => ({ data: { signedUrl: `/signed/${bucket}/${p}?exp=${exp}${opt?.download ? '&dl=' + encodeURIComponent(opt.download) : ''}` }, error: null }),
    createSignedUrls: async (ps) => ({ data: ps.map((p) => ({ signedUrl: '/assets/signature.png?p=' + p })), error: null }),
  }) },
});
