// Ejecución completa del monitor: comprueba, guarda el estado y publica status.json.
// Uso: node monitor/run.mjs   (las opciones se leen de variables de entorno, ver config.mjs)
import { loadConfig } from './config.mjs';
import { createHttp, sleep as realSleep } from './lib/http.mjs';
import { loadState, saveJson } from './lib/state.mjs';
import { imapConfigured, formMailConfigured, inspectInbox } from './lib/mailbox.mjs';
import { checkPage } from './checks/page.mjs';
import { inspectForm, emptySubmit, combineForm } from './checks/form.mjs';
import { browserCheck as realBrowserCheck } from './checks/browser.mjs';
import { evaluateReception, evaluateAutomations, when } from './checks/reception.mjs';
import { COMPONENTS, computeGlobal, updateIncidents, buildPublicStatus } from './lib/aggregate.mjs';

// A y B: página y formulario
async function checkSite(cfg, http, browserCheck) {
  const page = await checkPage(cfg, http);
  if (!page.page) {
    return { page, form: { state: 'unknown', cause: page.cause, summary: 'No comprobable', detail: 'La página de contacto no está disponible, no se puede revisar el formulario' } };
  }
  const structure = await inspectForm(cfg, http, page.page);
  const submit = cfg.emptySubmitCheck && structure.found ? await emptySubmit(cfg, http, page.page) : null;
  const browser = cfg.browserCheck && structure.found ? await browserCheck(cfg) : null;
  return { page, form: combineForm({ structure, submit, browser }) };
}

// Si algo falló en la primera pasada pero va bien en la segunda, es un fallo intermitente (naranja)
function confirm(first, second, firstAt, delayMin) {
  if (first.state !== 'fail' || second.state === 'fail') return second;
  return {
    ...second,
    state: 'warn',
    summary: 'Fallo intermitente',
    detail: `Falló a las ${when(firstAt).split(' a las ')[1]} (${first.detail.charAt(0).toLowerCase() + first.detail.slice(1)}) y funcionó al repetir la comprobación ${delayMin} min después`,
  };
}

async function readInbox(cfg, lookup, now) {
  if (!imapConfigured(cfg) || !formMailConfigured(cfg)) return { status: 'not_configured' };
  try {
    return { status: 'ok', ...(await lookup(cfg, now)) };
  } catch (err) {
    console.log('Buzón no accesible:', err.message);
    return { status: 'error' };
  }
}

export async function runMonitor({
  cfg = loadConfig(), http, lookup = inspectInbox, browserCheck = realBrowserCheck,
  sleep = realSleep, now = () => new Date(), state,
} = {}) {
  http ||= createHttp(cfg);
  state ||= await loadState(cfg.statePath);
  const t = now();
  const nowIso = t.toISOString();
  const log = (...a) => console.log(`[${nowIso}]`, ...a);

  // A y B, con una segunda pasada de confirmación si algo falla
  let { page, form } = await checkSite(cfg, http, browserCheck);
  if (page.state === 'fail' || form.state === 'fail') {
    log('Fallo detectado; se repite la comprobación para confirmarlo:', page.detail, '|', form.detail);
    await sleep(cfg.confirmDelayMs);
    const again = await checkSite(cfg, http, browserCheck);
    const delayMin = Math.max(1, Math.round(cfg.confirmDelayMs / 60000));
    page = { ...confirm(page, again.page, nowIso, delayMin), metrics: again.page.metrics };
    form = confirm(form, again.form, nowIso, delayMin);
  }
  log('A página:', page.state, '-', page.detail);
  log('B formulario:', form.state, '-', form.detail);

  // C y D: lectura del buzón
  const inbox = await readInbox(cfg, lookup, t);
  const reception = evaluateReception(cfg, inbox, t);
  const automations = evaluateAutomations(cfg, inbox, t);
  log('C recepción:', reception.state, '-', reception.detail);
  log('D automatizaciones:', automations.state, '-', automations.detail);

  const raw = { pagina: page, formulario: form, envio: reception, automatizaciones: automations };
  const components = COMPONENTS.map((c) => {
    const r = raw[c.id];
    return { ...c, state: r.state, summary: r.summary, detail: r.detail, cause: r.cause, pending: Boolean(r.pending), checkedAt: nowIso };
  });

  const global = computeGlobal(components, cfg);
  updateIncidents(state, global, components, nowIso);
  state.components = Object.fromEntries(components.map((c) => [c.id, c.state]));
  state.history = [...state.history, { t: nowIso, g: global.state, ms: page.metrics?.responseMs ?? null, c: state.components }].slice(-200);

  const status = buildPublicStatus({
    cfg, nowIso, components, global, state, pageMetrics: page.metrics,
    inbox: inbox.status === 'ok' ? inbox : null,
  });
  log('Estado general:', global.state, '-', global.message);
  return { state, status };
}

// Ejecución directa
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  try {
    const { state, status } = await runMonitor({ cfg });
    await saveJson(cfg.statePath, state);
    await saveJson(cfg.statusPath, status);
  } catch (err) {
    // Si el monitor falla no se publica nada nuevo: el panel detectará los datos caducados
    // y dejará de mostrar verde. El job falla para que GitHub avise por correo.
    console.error('El monitor ha fallado:', err);
    process.exitCode = 1;
  }
}
