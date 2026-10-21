// Doble de pruebas: simula welbi.es, el navegador de comprobación y el buzón.
import { emptyState } from '../lib/state.mjs';
import { loadConfig } from '../config.mjs';

export const FORM_HTML = `<!doctype html><html><head><title>Welbi</title>
<script src="https://www.google.com/recaptcha/api.js" async defer></script></head><body>
<h2>Contacto</h2>
<form method="post">
  <input type="hidden" name="csrfmiddlewaretoken" value="tok123">
  <input type="text" name="website" id="id_website" style="display:none">
  <input type="text" name="nombre" id="id_nombre" required>
  <input type="email" name="email" id="id_email" required>
  <input type="text" name="empresa" id="id_empresa">
  <textarea name="mensaje" id="id_mensaje" required></textarea>
  <div class="g-recaptcha" data-sitekey="6Lc-test" data-size="normal"></div>
  <input type="checkbox" name="acepta_politica" id="id_acepta_politica">
  <button type="submit">Enviar</button>
</form>
${'<p>relleno</p>'.repeat(100)}
</body></html>`;

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const START = new Date('2026-10-21T07:17:00Z');
const ago = (ms) => new Date(START.getTime() - ms).toISOString();

export function makeCfg(over = {}) {
  return loadConfig({
    retries: 2,
    retryDelayMs: 0,
    confirmDelayMs: 120000,
    imap: { host: 'imap.test', port: 993, user: 'u', pass: 'p', mailbox: 'INBOX' },
    formMailFrom: 'no-reply@welbi.es',
    autoresponseSubject: 'Gracias por contactar',
    runUrl: '',
    ...over,
  });
}

export function makeWorld(over = {}) {
  return {
    pageStatus: 200,
    pageMs: 300,
    pageHtml: FORM_HTML,
    pageDown: false,
    internet: true,
    controlReachable: true,
    submitStatus: 200,          // respuesta al envío vacío
    submitHtml: FORM_HTML.replace('<form', '<ul class="errorlist"><li>Este campo es obligatorio.</li></ul><form'),
    browser: { captcha: true, submitVisible: true, jsErrors: 0 },
    inbox: { lastMessageAt: ago(1 * DAY), lastTestAt: ago(2 * DAY), autoresponseAt: new Date(START.getTime() - 2 * DAY + 30000).toISOString() },
    onSleep: null,              // cambios del mundo durante la espera de confirmación
    posts: [],
    ...over,
  };
}

export function fakeHttp(world) {
  const headers = (h = {}) => ({ get: (k) => h[k.toLowerCase()] ?? null });
  const net = () => {
    const e = new Error('ENOTFOUND');
    e.code = 'ENOTFOUND';
    throw e;
  };
  async function request(url, opts = {}) {
    if (!world.internet) net();
    const u = new URL(url);
    if (u.hostname === 'www.gstatic.com') {
      if (!world.controlReachable) net();
      return { ok: true, status: 204, ms: 20, headers: headers(), cookies: {}, text: '' };
    }
    if (world.pageDown) {
      const e = new Error('timeout');
      e.code = 'TIMEOUT';
      throw e;
    }
    if (u.pathname === '/contacto/' && (opts.method || 'GET') === 'GET') {
      return { ok: world.pageStatus < 400, status: world.pageStatus, ms: world.pageMs, headers: headers({ 'content-type': 'text/html; charset=utf-8' }), cookies: { csrftoken: 'cookie123' }, text: world.pageHtml };
    }
    if (u.pathname === '/contacto/' && opts.method === 'POST') {
      world.posts.push(Object.fromEntries(new URLSearchParams(opts.body)));
      return { ok: world.submitStatus < 400, status: world.submitStatus, ms: 200, headers: headers({ 'content-type': 'text/html' }), cookies: {}, text: world.submitHtml };
    }
    return { ok: true, status: 200, ms: 30, headers: headers({ 'content-type': 'application/javascript' }), cookies: {}, text: '' };
  }
  return { request, get: (u, o) => request(u, o), reachable: async (u) => { try { return (await request(u)).status < 500; } catch { return false; } } };
}

export const fakeBrowser = (world) => async () => {
  if (world.browser === null) return { skipped: true, problems: [], warnings: [] };
  const out = { skipped: false, problems: [], warnings: [] };
  if (!world.browser.captcha) out.problems.push('el reCAPTCHA no aparece al abrir la página en un navegador');
  if (!world.browser.submitVisible) out.problems.push('el botón Enviar no se ve en el navegador');
  if (world.browser.jsErrors) out.warnings.push(`la página lanza ${world.browser.jsErrors} errores de JavaScript`);
  return out;
};

export const fakeLookup = (world) => async () => {
  if (world.inbox === 'error') throw new Error('AUTHENTICATIONFAILED');
  return { ...world.inbox };
};

export const fakeSleep = (world) => async () => { world.onSleep?.(world); };

export const clock = (start = START) => {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms) => { t += ms; } };
};

export { emptyState, ago };
