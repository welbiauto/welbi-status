// Resumen semanal por correo: estado del formulario y enlace al panel.
// Se envía con Brevo usando la misma clave del monitor. Uso: node monitor/report.mjs
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.mjs';
import { createHttp } from './lib/http.mjs';

export const REPORT_TAG = 'welbi-monitor-resumen';

const TZ = 'Europe/Madrid';
const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const COLOR = { ok: '#1e9e5a', warn: '#e07800', fail: '#d33a2c', unknown: '#8a9696' };
const LABEL = { ok: 'Correcto', warn: 'Aviso', fail: 'Fallo', unknown: 'Sin datos' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildReport(status, { panelUrl, now = new Date() }) {
  const ageMin = (now - new Date(status.generatedAt)) / 60000;
  const stale = ageMin > (status.staleAfterMin || 5760);
  const state = stale ? 'unknown' : status.global.state;

  const subject = {
    ok: 'Formulario de contacto de Welbi: todo en orden',
    warn: 'Formulario de contacto de Welbi: hay algo que revisar',
    fail: 'Formulario de contacto de Welbi: incidencia detectada',
    unknown: 'Formulario de contacto de Welbi: no se ha podido comprobar',
  }[state];

  const intro = {
    ok: 'Esta semana el formulario de contacto de welbi.es funciona correctamente: la página carga, el formulario acepta envíos y los avisos de las solicitudes se entregan en vuestro correo.',
    warn: 'El formulario de contacto funciona, pero hay un aviso que conviene revisar. Tenéis el detalle abajo y en el panel.',
    fail: 'Se ha detectado un fallo en el formulario de contacto. Es posible que alguna solicitud no os esté llegando. Tenéis el detalle abajo y en el panel.',
    unknown: 'Esta semana no se ha podido completar la comprobación del formulario. No significa necesariamente que falle, pero conviene revisarlo.',
  }[state];

  const when = fmt.format(new Date(status.generatedAt));
  const rows = status.components.map((c) => {
    const st = stale ? 'unknown' : c.state;
    return `<tr>
      <td style="padding:12px 0;border-top:1px solid #e3ebe7;vertical-align:top;width:22px"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${COLOR[st]};margin-top:4px"></span></td>
      <td style="padding:12px 0;border-top:1px solid #e3ebe7;vertical-align:top">
        <div style="font-size:13px;color:#4a6464">${esc(c.name)}</div>
        <div style="font-size:15px;font-weight:700;color:#0a3d3f">${esc(c.summary)} <span style="font-size:11px;font-weight:600;color:${COLOR[st]};text-transform:uppercase;letter-spacing:.06em">· ${LABEL[st]}</span></div>
        <div style="font-size:13px;color:#4a6464">${esc(c.detail)}</div>
      </td></tr>`;
  }).join('');

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f5f3;font-family:Arial,Helvetica,sans-serif;color:#0a3d3f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-top:6px solid ${COLOR[state]};padding:28px">
<tr><td>
  <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${COLOR[state]};font-weight:700">Resumen semanal</div>
  <h1 style="margin:6px 0 10px;font-size:22px;line-height:1.25;color:#0a3d3f">${esc(stale ? 'No se ha podido comprobar el formulario.' : status.global.message)}</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#2c4a4a">${intro}</p>
  ${!stale && status.global.highlight ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fff6ea;border-radius:8px;font-size:14px;font-weight:700">${esc(status.global.highlight)}</p>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  <p style="margin:18px 0 22px;font-size:13px;color:#4a6464">Última comprobación: ${esc(when)} (hora peninsular).</p>
  <a href="${esc(panelUrl)}" style="display:inline-block;background:#0a3d3f;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px">Ver el panel de estado</a>
  <p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#7a8f8f">Correo automático del panel de estado del formulario de contacto de Welbi. El panel se comprueba cada 3 días y se puede consultar en cualquier momento en ${esc(panelUrl)}</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    stale ? 'No se ha podido comprobar el formulario.' : status.global.message,
    '',
    intro,
    '',
    ...status.components.map((c) => `- ${c.name}: ${c.summary} (${LABEL[stale ? 'unknown' : c.state]})`),
    '',
    `Última comprobación: ${when}`,
    `Panel de estado: ${panelUrl}`,
  ].join('\n');

  return { subject, html, text, state };
}

export async function sendReport({ cfg = loadConfig(), http = createHttp(loadConfig()), status, now = new Date() }) {
  const { reportTo, reportFrom, reportFromName, panelUrl } = cfg.report;
  if (!cfg.brevo.apiKey || !reportTo || !reportFrom) {
    throw new Error('Faltan BREVO_API_KEY, REPORT_TO o REPORT_FROM para enviar el resumen');
  }
  const r = buildReport(status, { panelUrl, now });
  const body = {
    sender: { email: reportFrom, name: reportFromName },
    to: reportTo.split(',').map((e) => ({ email: e.trim() })).filter((x) => x.email),
    subject: r.subject,
    htmlContent: r.html,
    textContent: r.text,
    tags: [REPORT_TAG],
  };
  const res = await http.request('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.brevo.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`Brevo no aceptó el resumen (HTTP ${res.status})`);
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  try {
    const status = JSON.parse(await readFile(cfg.statusPath, 'utf8'));
    const r = await sendReport({ cfg, http: createHttp(cfg), status });
    console.log('Resumen semanal enviado:', r.state);
  } catch (err) {
    console.error('No se pudo enviar el resumen semanal:', err.message);
    process.exitCode = 1;
  }
}
