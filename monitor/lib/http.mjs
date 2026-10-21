// Cliente HTTP mínimo sobre fetch nativo, con tiempo de respuesta y cookies.

const UA = 'WelbiStatusMonitor/1.0 (+monitorizacion formulario de contacto)';

export function createHttp({ timeoutMs }) {
  async function request(url, { method = 'GET', headers = {}, body, redirect = 'follow' } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', ...headers },
        body,
        redirect,
        signal: ctrl.signal,
      });
      const text = await res.text();
      const ms = Math.round(performance.now() - t0);
      return {
        ok: res.ok,
        status: res.status,
        ms,
        url: res.url,
        headers: res.headers,
        cookies: parseSetCookie(res.headers),
        text,
      };
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      const e = new Error(err.name === 'AbortError' ? 'timeout' : (err.cause?.code || err.message));
      e.code = err.name === 'AbortError' ? 'TIMEOUT' : (err.cause?.code || 'NETWORK');
      e.ms = ms;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function reachable(url) {
    try {
      const r = await request(url);
      return r.status < 500;
    } catch {
      return false;
    }
  }

  return { request, get: (u, o) => request(u, o), reachable };
}

function parseSetCookie(headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const jar = {};
  for (const line of list) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
