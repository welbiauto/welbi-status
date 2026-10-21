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
