// A. Disponibilidad de la página de contacto
import { sleep } from '../lib/http.mjs';

export async function checkPage(cfg, http) {
  let last = null;

  for (let attempt = 1; attempt <= cfg.retries; attempt++) {
    try {
      const r = await http.get(cfg.contactUrl);
      if (r.status >= 200 && r.status < 300) {
        const isHtml = (r.headers.get('content-type') || '').includes('text/html');
        const result = {
          state: 'ok',
          summary: 'Página accesible',
          detail: `HTTP ${r.status} · ${r.ms} ms`,
          metrics: { responseMs: r.ms, httpStatus: r.status, attempts: attempt },
          page: { html: r.text, cookies: r.cookies, url: r.url },
        };
        if (!isHtml || r.text.length < 1000) {
          return { ...result, state: 'warn', summary: 'Respuesta anómala', detail: `La página responde, pero el contenido no parece válido (HTTP ${r.status})` };
        }
        if (r.ms > cfg.slowMs) {
          return { ...result, state: 'warn', summary: 'Respuesta lenta', detail: `${r.ms} ms (límite ${cfg.slowMs} ms)` };
        }
        if (attempt > 1) {
          return { ...result, state: 'warn', summary: 'Accesible tras reintentos', detail: `Respondió al intento ${attempt} · ${r.ms} ms` };
        }
        return result;
      }
      last = { kind: 'http', status: r.status, ms: r.ms };
      // Un 404 o 403 no se arregla reintentando al momento
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch (err) {
      last = { kind: 'network', code: err.code, ms: err.ms };
    }
    if (attempt < cfg.retries) await sleep(cfg.retryDelayMs * attempt);
  }

  // ¿Falla Welbi o falla la red del propio monitor?
  if (!(await http.reachable(cfg.controlUrl))) {
    return {
      state: 'unknown',
      cause: 'monitor',
      summary: 'Sin conexión desde el monitor',
      detail: 'El monitor no tiene salida a internet; no se puede valorar la página',
      metrics: {},
    };
  }

  const detail = last.kind === 'http'
    ? `HTTP ${last.status} tras ${cfg.retries} intentos`
    : last.code === 'TIMEOUT'
      ? `Sin respuesta en ${Math.round(cfg.timeoutMs / 1000)} s (${cfg.retries} intentos)`
      : `Error de conexión (${last.code})`;

  return {
    state: 'fail',
    summary: last.kind === 'http' && last.status >= 500 ? 'Error del servidor' : 'Página inaccesible',
    detail,
    metrics: { responseMs: last.ms ?? null, httpStatus: last.status ?? null, attempts: cfg.retries },
  };
}
