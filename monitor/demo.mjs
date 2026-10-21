// Genera site/data/demo.json con tres escenarios producidos por el monitor real
// sobre un welbi.es simulado. La landing los usa solo si no existe status.json.
import { runMonitor } from './run.mjs';
import { saveJson } from './lib/state.mjs';
import { makeCfg, makeWorld, fakeHttp, fakeLookup, fakeBrowser, fakeSleep, clock, emptyState, DAY, HOUR } from './test/fake.mjs';

async function scenario(build) {
  const ctx = { cfg: makeCfg(), world: makeWorld(), clock: clock(), state: emptyState() };
  let status;
  const tick = async () => {
    ({ status } = await runMonitor({
      cfg: ctx.cfg, http: fakeHttp(ctx.world), lookup: fakeLookup(ctx.world), browserCheck: fakeBrowser(ctx.world),
      sleep: fakeSleep(ctx.world), now: ctx.clock.now, state: ctx.state,
    }));
  };
  // Fechas del buzón relativas al reloj simulado
  const inbox = (msgAgo, testAgo, autoAfterSec) => {
    const n = ctx.clock.now().getTime();
    ctx.world.inbox = {
      lastMessageAt: new Date(n - msgAgo).toISOString(),
      lastTestAt: testAgo == null ? null : new Date(n - testAgo).toISOString(),
      autoresponseAt: testAgo == null || autoAfterSec == null ? null : new Date(n - testAgo + autoAfterSec * 1000).toISOString(),
    };
  };
  await build({ ctx, tick, inbox });
  return status;
}

const quiet = console.log;
console.log = () => {};

// Correcto, con una caída antigua ya resuelta en el historial
const ok = await scenario(async ({ ctx, tick, inbox }) => {
  inbox(20 * HOUR, 2 * DAY, 41);
  await tick();
  ctx.clock.advance(3 * DAY); ctx.world.pageDown = true; await tick();
  ctx.clock.advance(3 * DAY); ctx.world.pageDown = false; inbox(5 * HOUR, 4 * DAY, 41); await tick();
  ctx.clock.advance(3 * DAY); inbox(26 * HOUR, 7 * DAY + 4 * HOUR, 41); await tick();
});

// Parcial: hace 6 días que no llega ninguna solicitud
const warn = await scenario(async ({ ctx, tick, inbox }) => {
  inbox(20 * HOUR, 2 * DAY, 41);
  await tick();
  ctx.clock.advance(3 * DAY); inbox(6 * DAY + 3 * HOUR, 8 * DAY, 41); await tick();
});

// Incidencia: el servidor da error al recibir envíos
const fail = await scenario(async ({ ctx, tick, inbox }) => {
  inbox(20 * HOUR, 2 * DAY, 41);
  await tick();
  ctx.clock.advance(3 * DAY); ctx.world.submitStatus = 500; inbox(2 * DAY + 5 * HOUR, 5 * DAY, 41); await tick();
});

console.log = quiet;
await saveJson('site/data/demo.json', { demo: true, note: 'Datos de ejemplo generados por el monitor sobre un entorno simulado. No son datos reales.', scenarios: { ok, warn, fail } });
for (const [k, s] of Object.entries({ ok, warn, fail })) {
  console.log(`## ${k}: ${s.global.state} · ${s.global.message} ${s.global.highlight || ''}`);
  for (const c of s.components) console.log(`   ${c.id} ${c.state} · ${c.summary} · ${c.detail}`);
  console.log(`   incidencias: ${s.incidents.map((i) => `${i.status} (${i.summary})`).join(' / ') || 'ninguna'}`);
}
