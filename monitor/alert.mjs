// Aviso por correo cuando hay un problema serio:
//  · el estado general está en ROJO, o
//  · lleva más de ALERT_WARN_DAYS días (10 por defecto) en NARANJA sin volver a verde.
// Se envía UNA vez por episodio y se rearma cuando el panel vuelve a verde.
// Se envía desde Gmail (savilecodegestion@gmail.com) con una contraseña de aplicación.
//
// Uso (después de monitor/run.mjs): node monitor/alert.mjs
import { readFile } from 'node:fs/promises';
import { saveJson } from './lib/state.mjs';

const DAY = 86400000;
const env = process.env;
const str = (v, d = '') => (v === undefined || v === '' ? d : v);

export function alertConfig(over = {}) {
  return {
    to: str(env.ALERT_TO, 'asisgarteiz@welbi.es'),
    from: str(env.GMAIL_USER, 'savilecodegestion@gmail.com'),
    fromName: str(env.ALERT_FROM_NAME, 'Savilecode · Estado del formulario'),
    appPassword: str(env.GMAIL_APP_PASSWORD),
    warnDays: Number(str(env.ALERT_WARN_DAYS, '10')),
    panelUrl: str(env.PANEL_URL, 'https://welbiauto.github.io/welbi-status/'),
    supportEmail: str(env.SUPPORT_EMAIL, 'support@savilecode.com'),
    contactName: str(env.SUPPORT_NAME, 'Jon Maza'),
    contactPhone: str(env.SUPPORT_PHONE, '661 342 289'),
    statePath: str(env.STATE_PATH, '.state/state.json'),
    statusPath: str(env.STATUS_PATH, '.state/status.json'),
    ...over,
  };
}

// Decide si hay que avisar y actualiza el registro del episodio en state.alert.
// Devuelve { send: boolean, reason: 'rojo' | 'naranja' | null }.
export function decideAlert(state, status, cfg, now = new Date()) {
  const a = (state.alert ||= { problemSince: null, sentAt: null, sentReason: null });
  const g = status.global.state;

  if (g === 'ok') {
    // Vuelve a verde: se cierra el episodio y se rearma el aviso
    a.problemSince = null;
    a.sentAt = null;
    a.sentReason = null;
    return { send: false, reason: null };
  }
  if (g === 'unknown') return { send: false, reason: null }; // fallo del propio monitor: no se avisa al cliente

  a.problemSince ||= status.generatedAt || now.toISOString();
  if (a.sentAt) return { send: false, reason: null }; // ya avisado en este episodio

  if (g === 'fail') return { send: true, reason: 'rojo' };
  const days = (now - new Date(a.problemSince)) / DAY;
  if (g === 'warn' && days >= cfg.warnDays) return { send: true, reason: 'naranja' };
  return { send: false, reason: null };
}

const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' });
const fmtFull = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildAlert(status, state, reason, cfg, now = new Date()) {
  const since = state.alert?.problemSince || status.generatedAt;
  const days = Math.max(0, Math.floor((now - new Date(since)) / DAY));
  const failing = status.components.filter((c) => c.state === 'fail' || c.state === 'warn');
  const phoneHref = cfg.contactPhone.replace(/\s+/g, '');

  const subject = reason === 'rojo'
    ? 'Incidencia en el formulario de contacto de welbi.es'
    : `El formulario de contacto de welbi.es lleva ${days} días con avisos`;

  const what = reason === 'rojo'
    ? 'El sistema de monitorización ha detectado un fallo en el formulario de contacto de welbi.es. Es posible que algunas solicitudes de clientes no os estén llegando.'
    : `El formulario de contacto de welbi.es lleva ${days} días con avisos sin volver a la normalidad (desde el ${fmt.format(new Date(since))}). Conviene revisarlo para asegurarse de que no se están perdiendo solicitudes.`;

  const rowsHtml = failing.map((c) => `<li style="margin:0 0 8px"><b>${esc(c.name)}:</b> ${esc(c.summary)}. <span style="color:#4a6464">${esc(c.detail)}</span></li>`).join('');
  const rowsText = failing.map((c) => `- ${c.name}: ${c.summary}. ${c.detail}`).join('\n');

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f5f3;font-family:Arial,Helvetica,sans-serif;color:#0a3d3f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-top:6px solid ${reason === 'rojo' ? '#d33a2c' : '#e07800'};padding:28px"><tr><td>
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:${reason === 'rojo' ? '#d33a2c' : '#e07800'}">Aviso del panel de estado</p>
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3">${esc(subject)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.55">Hola,</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(what)}</p>
${status.global.highlight ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fff6ea;border-radius:8px;font-size:14px;font-weight:700">${esc(status.global.highlight)}</p>` : ''}
${rowsHtml ? `<p style="margin:0 0 6px;font-size:14px;font-weight:700">Qué se ha detectado</p><ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.5">${rowsHtml}</ul>` : ''}
<p style="margin:0 0 14px;font-size:15px;line-height:1.55"><b>Os recomendamos poneros en contacto con nosotros</b> para revisarlo cuanto antes:</p>
<ul style="margin:0 0 18px;padding-left:18px;font-size:15px;line-height:1.6">
<li>Correo: <a href="mailto:${esc(cfg.supportEmail)}" style="color:#0a3d3f">${esc(cfg.supportEmail)}</a></li>
<li>Teléfono: ${esc(cfg.contactName)}, <a href="tel:+34${esc(phoneHref)}" style="color:#0a3d3f">${esc(cfg.contactPhone)}</a></li>
</ul>
<a href="${esc(cfg.panelUrl)}" style="display:inline-block;background:#0a3d3f;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px">Ver el panel de estado</a>
<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#7a8f8f">Comprobación del ${esc(fmtFull.format(new Date(status.generatedAt)))} (hora peninsular). Aviso automático del panel de estado del formulario de contacto de Welbi, gestionado por Savilecode. Solo se envía un aviso por incidencia.</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    'Hola,',
    '',
    what,
    status.global.highlight ? `\n${status.global.highlight}` : '',
    rowsText ? `\nQué se ha detectado:\n${rowsText}` : '',
    '',
    'Os recomendamos poneros en contacto con nosotros para revisarlo cuanto antes:',
    `- Correo: ${cfg.supportEmail}`,
    `- Teléfono: ${cfg.contactName}, ${cfg.contactPhone}`,
    '',
    `Panel de estado: ${cfg.panelUrl}`,
    '',
    'Aviso automático del panel de estado del formulario de contacto de Welbi, gestionado por Savilecode.',
  ].join('\n');

  return { subject, html, text };
}

async function gmailSend(cfg, msg) {
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: cfg.from, pass: cfg.appPassword },
  });
  await transport.sendMail({
    from: { name: cfg.fromName, address: cfg.from },
    to: cfg.to,
    replyTo: cfg.supportEmail,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

export async function runAlert({ cfg = alertConfig(), send = gmailSend, now = new Date(), state, status } = {}) {
  state ||= JSON.parse(await readFile(cfg.statePath, 'utf8'));
  status ||= JSON.parse(await readFile(cfg.statusPath, 'utf8'));
  const decision = decideAlert(state, status, cfg, now);
  if (decision.send) {
    if (!cfg.appPassword) throw new Error('Falta el secreto GMAIL_APP_PASSWORD: no se puede enviar el aviso');
    const msg = buildAlert(status, state, decision.reason, cfg, now);
    await send(cfg, msg);
    state.alert.sentAt = now.toISOString();
    state.alert.sentReason = decision.reason;
    console.log(`Aviso enviado (${decision.reason}).`);
  } else {
    console.log('Sin aviso que enviar.');
  }
  return { state, decision };
}

// Correo de prueba: muestra cómo sería un aviso en rojo, sin tocar el estado del monitor.
export async function sendTestAlert({ cfg = alertConfig(), send = gmailSend, to, status, now = new Date() } = {}) {
  if (!cfg.appPassword) throw new Error('Falta el secreto GMAIL_APP_PASSWORD');
  status ||= JSON.parse(await readFile(cfg.statusPath, 'utf8'));
  const sample = {
    ...status,
    global: { state: 'fail', message: 'Incidencia detectada en el sistema de contacto.', highlight: 'Esto es una PRUEBA: el formulario funciona con normalidad.' },
    components: [{ id: 'prueba', name: 'Correo de prueba', state: 'fail', summary: 'Simulación de incidencia', detail: 'Este mensaje solo comprueba que los avisos llegan correctamente' }],
  };
  const msg = buildAlert(sample, { alert: { problemSince: status.generatedAt } }, 'rojo', cfg, now);
  await send({ ...cfg, to }, { ...msg, subject: `[PRUEBA] ${msg.subject}` });
  console.log('Correo de prueba enviado.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = alertConfig();
  if (process.env.ALERT_TEST_TO) {
    try {
      await sendTestAlert({ cfg, to: process.env.ALERT_TEST_TO });
    } catch (err) {
      console.error('No se pudo enviar el correo de prueba:', err.message);
      process.exitCode = 1;
    }
  } else try {
    const { state } = await runAlert({ cfg });
    await saveJson(cfg.statePath, state);
  } catch (err) {
    // Si el envío falla, no se marca como enviado: se reintentará en la próxima comprobación
    console.error('No se pudo enviar el aviso:', err.message);
    process.exitCode = 1;
  }
}
