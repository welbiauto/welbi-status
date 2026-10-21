import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runMonitor } from '../run.mjs';
import { inspectForm, combineForm } from '../checks/form.mjs';
import {
  makeCfg, makeWorld, fakeHttp, fakeLookup, fakeBrowser, fakeSleep, clock, emptyState, ago, DAY, HOUR, START,
} from './fake.mjs';

function setup(worldOver = {}, cfgOver = {}) {
  return { cfg: makeCfg(cfgOver), world: makeWorld(worldOver), clock: clock(), state: emptyState() };
}
async function tick(ctx) {
  const { state, status } = await runMonitor({
    cfg: ctx.cfg, http: fakeHttp(ctx.world), lookup: fakeLookup(ctx.world), browserCheck: fakeBrowser(ctx.world),
    sleep: fakeSleep(ctx.world), now: ctx.clock.now, state: ctx.state,
  });
  ctx.state = state;
  return status;
}
const comp = (s, id) => s.components.find((c) => c.id === id);

test('todo correcto → verde, con detalles legibles', async () => {
  const s = await tick(setup());
  assert.equal(s.global.state, 'ok');
  assert.equal(s.global.message, 'Todos los sistemas operativos.');
  assert.match(comp(s, 'formulario').detail, /reCAPTCHA visible en navegador · el servidor valida los envíos/);
  assert.match(comp(s, 'envio').detail, /al menos una en los últimos 4 días/);
  assert.equal(s.reception.lastTestAt, ago(2 * DAY));
  assert.match(comp(s, 'automatizaciones').detail, /llegó en 30 s/);
  assert.equal(s.checkEveryMin, 72 * 60);
});

test('el envío vacío de control no lleva datos y no puede crear solicitudes', async () => {
  const ctx = setup();
  await tick(ctx);
  assert.equal(ctx.world.posts.length, 1);
  assert.deepEqual(Object.keys(ctx.world.posts[0]).sort(), ['csrfmiddlewaretoken', 'website']);
  assert.equal(ctx.world.posts[0].website, '');
});

test('página caída → se confirma con una segunda pasada y queda en rojo; luego se resuelve', async () => {
  const ctx = setup({ pageDown: true });
  let s = await tick(ctx);
  assert.equal(comp(s, 'pagina').state, 'fail');
  assert.equal(comp(s, 'formulario').state, 'unknown');
  assert.equal(s.global.state, 'fail');
  assert.equal(s.global.highlight, 'La página de contacto no está accesible.');
  assert.equal(s.lastIncident.status, 'abierta');

  ctx.world.pageDown = false;
  ctx.clock.advance(3 * DAY);
  ctx.world.inbox.lastMessageAt = ago(-3 * DAY + HOUR); // llegó una solicitud hace una hora
  s = await tick(ctx);
  assert.equal(s.global.state, 'ok');
  assert.equal(s.lastIncident.status, 'resuelta');
});

test('fallo que se recupera durante la confirmación → naranja "Fallo intermitente"', async () => {
  const ctx = setup({ pageDown: true, onSleep: (w) => { w.pageDown = false; } });
  const s = await tick(ctx);
  assert.equal(comp(s, 'pagina').state, 'warn');
  assert.equal(comp(s, 'pagina').summary, 'Fallo intermitente');
  assert.match(comp(s, 'pagina').detail, /Falló a las 09:17 .* funcionó al repetir la comprobación 2 min después/);
  assert.equal(s.global.state, 'warn');
});

test('sin internet en el monitor → estado desconocido, sin incidencia de Welbi', async () => {
  const ctx = setup({ pageDown: true, controlReachable: false, inbox: 'error' });
  const s = await tick(ctx);
  assert.equal(comp(s, 'pagina').cause, 'monitor');
  assert.equal(comp(s, 'envio').cause, 'monitor');
  assert.equal(s.global.state, 'unknown');
  assert.equal(s.incidents.length, 0);
});

test('el servidor da error al recibir envíos → formulario en rojo', async () => {
  const s = await tick(setup({ submitStatus: 500 }));
  assert.equal(comp(s, 'pagina').state, 'ok');
  assert.equal(comp(s, 'formulario').state, 'fail');
  assert.match(comp(s, 'formulario').detail, /HTTP 500/);
  assert.equal(s.global.highlight, 'La página de contacto carga, pero el formulario no está operativo.');
});

test('el reCAPTCHA no se pinta en el navegador → formulario en rojo', async () => {
  const s = await tick(setup({ browser: { captcha: false, submitVisible: true, jsErrors: 0 } }));
  assert.equal(comp(s, 'formulario').state, 'fail');
  assert.match(comp(s, 'formulario').detail, /reCAPTCHA no aparece/);
});

test('el servidor da por bueno un envío vacío → aviso', async () => {
  const s = await tick(setup({ submitStatus: 302 }));
  assert.equal(comp(s, 'formulario').state, 'warn');
});

test('navegador no disponible en el monitor → se omite sin alarmar', async () => {
  const s = await tick(setup({ browser: null }));
  assert.equal(comp(s, 'formulario').state, 'ok');
  assert.doesNotMatch(comp(s, 'formulario').detail, /navegador/);
});

test('6 días sin solicitudes → naranja; 12 días → rojo con mensaje claro', async () => {
  let s = await tick(setup({ inbox: { lastMessageAt: ago(6 * DAY), lastTestAt: null, autoresponseAt: null } }));
  assert.equal(comp(s, 'envio').state, 'warn');
  assert.match(comp(s, 'envio').detail, /hace 6 días. Puede ser poco tráfico/);
  s = await tick(setup({ inbox: { lastMessageAt: ago(12 * DAY), lastTestAt: null, autoresponseAt: null } }));
  assert.equal(comp(s, 'envio').state, 'fail');
  assert.equal(s.global.highlight, 'La página y el formulario funcionan, pero no se ha podido confirmar que las solicitudes lleguen al buzón.');
});

test('buzón sin configurar → recepción "no verificada", nunca verde', async () => {
  const s = await tick(setup({}, { imap: { host: '', port: 993, user: '', pass: '', mailbox: 'INBOX' } }));
  assert.equal(comp(s, 'envio').state, 'unknown');
  assert.equal(s.global.state, 'warn');
  assert.match(s.global.highlight, /Sin verificar: envío y recepción/);
});

test('sin automatización configurada → D en gris, el estado general puede ser verde', async () => {
  const s = await tick(setup({}, { autoresponseSubject: '' }));
  assert.equal(comp(s, 'automatizaciones').state, 'unknown');
  assert.equal(s.global.state, 'ok');
});

test('prueba manual sin respuesta automática → D en rojo, general naranja', async () => {
  const s = await tick(setup({ inbox: { lastMessageAt: ago(3 * HOUR), lastTestAt: ago(3 * HOUR), autoresponseAt: null } }));
  assert.equal(comp(s, 'envio').state, 'ok');
  assert.equal(comp(s, 'automatizaciones').state, 'fail');
  assert.equal(s.global.state, 'warn');
});

test('prueba manual de hace 10 minutos → respuesta automática en espera, sin incidencia', async () => {
  const s = await tick(setup({ inbox: { lastMessageAt: ago(10 * 60000), lastTestAt: ago(10 * 60000), autoresponseAt: null } }));
  assert.equal(comp(s, 'automatizaciones').summary, 'Esperando respuesta automática');
  assert.equal(s.incidents.length, 0);
});

test('el escáner reconoce el formulario real de welbi.es (marcado del 21/10/2026)', async () => {
  const html = await readFile(new URL('./welbi-form.fixture.html', import.meta.url), 'utf8');
  const cfg = makeCfg();
  const structure = await inspectForm(cfg, { get: async () => ({ status: 200 }) }, { html, cookies: { csrftoken: 'x' } });
  assert.equal(structure.found, true);
  assert.deepEqual(structure.problems, []);
  assert.deepEqual(structure.warnings, []);
  assert.equal(combineForm({ structure }).state, 'ok');
});

test('lo publicado y el estado interno no contienen direcciones de correo', async () => {
  const ctx = setup();
  const s = await tick(ctx);
  assert.doesNotMatch(JSON.stringify(s), /@/);
  assert.doesNotMatch(JSON.stringify(ctx.state), /@/);
});

void START;

// ---------------------------------------------------------------- Brevo
import { inspectBrevo } from '../lib/brevo.mjs';

function brevoHttp(world, events, account = { plan: [{ type: 'free', creditsType: 'sendLimit', credits: 280 }] }, status = 200) {
  const base = fakeHttp(world);
  const calls = [];
  const request = async (url, opts = {}) => {
    if (url.startsWith('https://api.brevo.com/')) {
      calls.push({ url, key: opts.headers?.['api-key'] });
      if (status !== 200) return { status, text: '{}', headers: { get: () => null } };
      const body = url.includes('/account') ? account : { events };
      return { status: 200, text: JSON.stringify(body), headers: { get: () => null } };
    }
    return base.request(url, opts);
  };
  return { ...base, request, get: (u, o) => request(u, o), calls };
}
const ev = (event, msAgo, subject = 'Nueva solicitud de presupuesto') => ({ event, date: new Date(START.getTime() - msAgo).toISOString(), subject, email: 'equipo@welbi.es' });

async function tickBrevo(ctx, http) {
  const { state, status } = await runMonitor({
    cfg: ctx.cfg, http, lookup: fakeLookup(ctx.world), browserCheck: fakeBrowser(ctx.world),
    sleep: fakeSleep(ctx.world), now: ctx.clock.now, state: ctx.state,
  });
  ctx.state = state;
  return status;
}
const brevoCfg = (over = {}) => ({ brevo: { apiKey: 'xkeysib-test', to: '', subject: '', lowCredits: 20, ...over }, imap: { host: '', port: 993, user: '', pass: '', mailbox: 'INBOX' } });

test('Brevo: avisos enviados y entregados → verde, con alerta de solicitudes nuevas', async () => {
  const ctx = setup({}, brevoCfg());
  const http = brevoHttp(ctx.world, [ev('requests', 5 * HOUR), ev('delivered', 5 * HOUR - 5000)]);
  const s = await tickBrevo(ctx, http);
  assert.equal(comp(s, 'envio').state, 'ok');
  assert.equal(comp(s, 'automatizaciones').state, 'ok');
  assert.equal(s.global.state, 'ok');
  assert.equal(s.requests.source, 'brevo');
  assert.equal(s.requests.newSincePrevious, true);
  assert.equal(http.calls[0].key, 'xkeysib-test');
  assert.doesNotMatch(JSON.stringify(s), /@|presupuesto/i, 'no se publican direcciones ni asuntos');
});

test('Brevo: sin solicitudes nuevas desde la comprobación anterior → sin alerta', async () => {
  const ctx = setup({}, brevoCfg());
  const http = brevoHttp(ctx.world, [ev('requests', 2 * DAY), ev('delivered', 2 * DAY)]);
  await tickBrevo(ctx, http); // primera comprobación
  ctx.clock.advance(3 * DAY);
  const s = await tickBrevo(ctx, brevoHttp(ctx.world, [ev('requests', 2 * DAY), ev('delivered', 2 * DAY)]));
  assert.equal(s.requests.newSincePrevious, false);
});

test('Brevo: rebote del aviso → recepción en rojo', async () => {
  const ctx = setup({}, brevoCfg());
  const s = await tickBrevo(ctx, brevoHttp(ctx.world, [ev('requests', 3 * HOUR), ev('hardBounces', 3 * HOUR - 4000)]));
  assert.equal(comp(s, 'envio').state, 'fail');
  assert.equal(comp(s, 'envio').summary, 'Avisos no entregados');
  assert.equal(s.global.state, 'fail');
});

test('Brevo: sin envíos disponibles → notificaciones en rojo', async () => {
  const ctx = setup({}, brevoCfg());
  const s = await tickBrevo(ctx, brevoHttp(ctx.world, [ev('requests', 3 * HOUR), ev('delivered', 3 * HOUR)], { plan: [{ type: 'free', creditsType: 'sendLimit', credits: 0 }] }));
  assert.equal(comp(s, 'automatizaciones').state, 'fail');
  assert.match(comp(s, 'automatizaciones').detail, /agotado/);
});

test('Brevo: clave no válida → gris "monitor", sin incidencia', async () => {
  const ctx = setup({}, brevoCfg());
  const s = await tickBrevo(ctx, brevoHttp(ctx.world, [], undefined, 401));
  assert.equal(comp(s, 'envio').cause, 'monitor');
  assert.equal(comp(s, 'envio').summary, 'Clave de Brevo no válida');
  assert.equal(s.incidents.length, 0);
});

test('Brevo: filtro por asunto ignora otros correos transaccionales', async () => {
  const cfg = makeCfg(brevoCfg({ subject: 'solicitud de presupuesto' }));
  const http = brevoHttp(makeWorld(), [ev('requests', 1 * HOUR, 'Factura de octubre'), ev('requests', 8 * DAY), ev('delivered', 8 * DAY)]);
  const r = await inspectBrevo(cfg, http, { now: START });
  assert.equal(r.lastSentAt, new Date(START.getTime() - 8 * DAY).toISOString());
});

// ---------------------------------------------------------------- Resumen semanal
import { buildReport, sendReport } from '../report.mjs';

test('resumen semanal: todo en orden → asunto positivo y enlace al panel', async () => {
  const s = await tick(setup());
  const r = buildReport(s, { panelUrl: 'https://welbiauto.github.io/welbi-status/', now: START });
  assert.equal(r.subject, 'Formulario de contacto de Welbi: todo en orden');
  assert.match(r.html, /href="https:\/\/welbiauto\.github\.io\/welbi-status\/"/);
  assert.match(r.text, /Panel de estado: https/);
});

test('resumen semanal: datos caducados → nunca dice "todo en orden"', async () => {
  const s = await tick(setup());
  const r = buildReport(s, { panelUrl: 'x', now: new Date(START.getTime() + 6 * DAY) });
  assert.equal(r.state, 'unknown');
  assert.match(r.subject, /no se ha podido comprobar/);
});

test('resumen semanal: se envía por Brevo con etiqueta propia', async () => {
  const s = await tick(setup());
  let sent;
  const http = { request: async (url, opts) => { sent = { url, body: JSON.parse(opts.body), key: opts.headers['api-key'] }; return { status: 201, text: '{}' }; } };
  const cfg = makeCfg({ brevo: { apiKey: 'k', to: '', subject: '', lowCredits: 20 }, report: { reportTo: 'cliente@ejemplo.com', reportFrom: 'avisos@welbi.es', reportFromName: 'Estado', panelUrl: 'https://p/' } });
  await sendReport({ cfg, http, status: s, now: START });
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email');
  assert.deepEqual(sent.body.to, [{ email: 'cliente@ejemplo.com' }]);
  assert.deepEqual(sent.body.tags, ['welbi-monitor-resumen']);
});

test('Brevo: los resúmenes del propio monitor no cuentan como solicitudes', async () => {
  const cfg = makeCfg(brevoCfg());
  const http = brevoHttp(makeWorld(), [
    { event: 'requests', date: new Date(START.getTime() - HOUR).toISOString(), subject: 'Formulario de contacto de Welbi: todo en orden', tags: ['welbi-monitor-resumen'] },
    ev('requests', 2 * DAY), ev('delivered', 2 * DAY),
  ]);
  const r = await inspectBrevo(cfg, http, { now: START });
  assert.equal(r.lastSentAt, new Date(START.getTime() - 2 * DAY).toISOString());
});
