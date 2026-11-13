import { supa } from '../supa.js';
import { $, toast } from '../util.js';

export async function render(el) {
  el.innerHTML = `<div class="center"><form class="card narrow" id="f" autocomplete="on">
    <div class="brand big"><span class="dot"></span>PROFORMA OS</div>
    <p class="muted">Administrator sign-in</p>
    <label class="field"><span class="label">Email</span><input class="input" type="email" name="email" autocomplete="username" required></label>
    <label class="field"><span class="label">Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn btn-primary wide" type="submit">Sign in</button>
  </form></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('button'); b.disabled = true;
    const { error } = await supa.auth.signInWithPassword({ email: e.target.email.value.trim(), password: e.target.password.value });
    b.disabled = false;
    if (error) return toast('Sign-in failed. Check your email and password.', 'bad');
    location.hash = '#/';
  });
}
