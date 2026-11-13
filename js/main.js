import { supa, configured } from './supa.js';
import { $, esc, toast } from './util.js';

const app = $('#app');
let cleanup = null;
let adminOk = null;      // cached admin check for the current user id
let adminFor = null;

function screen(html) { app.innerHTML = html; }

async function isAdmin(userId) {
  if (adminFor === userId) return adminOk;
  const { data, error } = await supa.from('admin_profile').select('user_id').eq('user_id', userId).maybeSingle();
  adminFor = userId; adminOk = !error && !!data; return adminOk;
}

async function signOut() { adminFor = null; await supa.auth.signOut(); location.hash = '#/login'; }

function shell(active) {
  if ($('#view')) { setActive(active); return; }
  screen(`<header class="topbar">
      <a class="brand" href="#/"><span class="dot"></span>PROFORMA OS</a>
      <nav aria-label="Main">
        <a href="#/" data-nav="/">Dashboard</a>
        <a href="#/proforma/new" data-nav="/proforma/new">New proforma</a>
        <a href="#/settings" data-nav="/settings">Settings</a>
      </nav>
      <button class="btn" id="signout" type="button">Sign out</button>
    </header><main id="view"></main>`);
  $('#signout').addEventListener('click', signOut);
  setActive(active);
}
function setActive(path) {
  document.querySelectorAll('[data-nav]').forEach((a) => { const on = a.dataset.nav === path; a.classList.toggle('active', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
}

async function route() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const path = location.hash.replace(/^#/, '') || '/';
  const { data: { session } } = await supa.auth.getSession();

  if (!session) {
    if (path !== '/login') { location.hash = '#/login'; return; }
    const m = await import('./views/login.js'); screen(''); cleanup = await m.render(app) || null; return;
  }
  if (path === '/login') { location.hash = '#/'; return; }
  if (!(await isAdmin(session.user.id))) {
    screen(`<div class="center"><div class="card narrow"><h1>No access</h1>
      <p class="muted">This account is not the administrator of Proforma OS.</p><button class="btn" id="so">Sign out</button></div></div>`);
    $('#so').addEventListener('click', signOut); return;
  }

  let name = 'dashboard', params = {}, nav = '/';
  let m;
  if ((m = /^\/proforma\/([\w-]+)$/.exec(path))) { name = 'editor'; params = { id: m[1] }; nav = m[1] === 'new' ? '/proforma/new' : '/'; }
  else if (path === '/settings') { name = 'settings'; nav = '/settings'; }
  shell(nav);
  const old = $('#view'); const view = old.cloneNode(false); old.replaceWith(view);   // fresh node: drops the previous view's listeners
  view.innerHTML = '<p class="muted pad">Loading…</p>';
  try {
    const mod = await import(`./views/${name}.js`);
    view.innerHTML = '';
    cleanup = await mod.render(view, { session }, params) || null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card pad"><h2>Something went wrong</h2><p class="muted">${esc(e.message || 'Please reload the page.')}</p></div>`;
  }
}

async function boot() {
  if (!configured) {
    screen(`<div class="center"><div class="card narrow"><h1>Almost there</h1>
      <p>Open <code>js/config.js</code> and paste your Supabase project URL and anon key, then reload. Step-by-step instructions are in the README.</p></div></div>`);
    return;
  }
  supa.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { adminFor = null; if (!location.hash.startsWith('#/login')) location.hash = '#/login'; } });
  window.addEventListener('hashchange', route);
  await route();
}
boot();
