// Cálculo del estado general, incidencias y estado público.

export const COMPONENTS = [
  { id: 'pagina', name: 'Disponibilidad de la página', critical: true },
  { id: 'formulario', name: 'Funcionamiento del formulario', critical: true },
  { id: 'envio', name: 'Envío y recepción de mensajes', critical: true },
  { id: 'automatizaciones', name: 'Automatizaciones y notificaciones', critical: false },
];

const RANK = { ok: 0, unknown: 1, warn: 2, fail: 3 };

export function computeGlobal(components, { automationsCritical = false } = {}) {
  const critical = (c) => c.critical || (c.id === 'automatizaciones' && automationsCritical);
  const by = Object.fromEntries(components.map((c) => [c.id, c]));

  if (components.filter(critical).every((c) => c.state === 'unknown' && c.cause === 'monitor')) {
    return { state: 'unknown', message: 'Estado desconocido. La monitorización no puede comprobar el sistema en este momento.', highlight: null };
  }
  if (components.some((c) => critical(c) && c.state === 'fail')) {
    return { state: 'fail', message: 'Incidencia detectada en el sistema de contacto.', highlight: highlight(by) };
  }
  // Una comprobación "en curso" no es una incidencia
  if (components.some((c) => (c.state === 'warn' && !c.pending) || c.state === 'fail')) {
    return { state: 'warn', message: 'Funcionamiento parcial. Estamos revisando una incidencia.', highlight: highlight(by) };
  }
  // Un control crítico sin datos impide el verde; uno no crítico (automatizaciones) se muestra en gris aparte
  const unverified = components.filter((c) => critical(c) && (c.state === 'unknown' || c.pending));
  if (unverified.length) {
    return {
      state: 'warn',
      message: 'Funcionamiento parcial. Hay comprobaciones pendientes de verificar.',
      highlight: `Sin verificar: ${unverified.map((c) => c.name.toLowerCase()).join(', ')}.`,
    };
  }
  return { state: 'ok', message: 'Todos los sistemas operativos.', highlight: null };
}

// Mensaje en lenguaje llano que señala qué parte del proceso falla.
function highlight(by) {
  const s = (id) => by[id]?.state;
  const up = (id) => s(id) === 'ok' || s(id) === 'warn';
  if (s('pagina') === 'fail') return 'La página de contacto no está accesible.';
  if (s('formulario') === 'fail') return 'La página de contacto carga, pero el formulario no está operativo.';
  if (s('envio') === 'fail' && up('pagina') && up('formulario')) return 'La página y el formulario funcionan, pero no se ha podido confirmar que las solicitudes lleguen al buzón.';
  if (s('envio') === 'fail') return 'No se ha podido confirmar que las solicitudes lleguen al buzón.';
  if (s('automatizaciones') === 'fail') return 'Las solicitudes llegan, pero la respuesta automática al cliente ha fallado.';
  const warn = Object.values(by).find((c) => c.state === 'warn' && !c.pending);
  return warn ? `${warn.name}: ${warn.summary.toLowerCase()}.` : null;
}

// Abre, actualiza y cierra incidencias según el estado general.
// Los problemas de la propia monitorización no abren incidencias del servicio.
export function updateIncidents(state, global, components, nowIso) {
  const open = state.incidents.find((i) => !i.resolvedAt);
  const affected = components.filter((c) => c.state === 'fail' || (c.state === 'warn' && !c.pending)).map((c) => c.id);

  if (global.state === 'fail' || global.state === 'warn') {
    if (!affected.length) return; // solo "sin verificar": no es una incidencia
    if (!open) {
      state.incidents.push({
        id: `inc-${nowIso.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
        openedAt: nowIso,
        resolvedAt: null,
        severity: global.state,
        components: affected,
        summary: global.highlight || global.message,
      });
    } else {
      if (RANK[global.state] > RANK[open.severity]) open.severity = global.state;
      open.components = [...new Set([...open.components, ...affected])];
      if (global.state === 'fail') open.summary = global.highlight || global.message;
    }
  } else if (global.state === 'ok' && open) {
    open.resolvedAt = nowIso;
  }
  state.incidents = state.incidents.slice(-20);
}

// Lo que se publica: solo información general, sin datos personales ni detalles internos.
export function buildPublicStatus({ cfg, nowIso, components, global, state, pageMetrics, inbox }) {
  const lastIncident = state.incidents.at(-1) || null;
  const worst = components.reduce((m, c) => Math.max(m, RANK[c.state]), 0);
  return {
    version: 2,
    mode: 'pasivo',
    generatedAt: nowIso,
    staleAfterMin: cfg.staleAfterMin,
    checkEveryMin: cfg.checkEveryHours * 60,
    runUrl: cfg.runUrl || null,
    global: { state: global.state, message: global.message, highlight: global.highlight },
    components: components.map(({ id, name, critical, state: st, summary, detail, cause, checkedAt }) => ({
      id, name, critical, state: st, summary, detail, cause: cause || null, checkedAt,
    })),
    lastCheck: {
      at: nowIso,
      result: ['Correcta', 'Correcta con controles sin verificar', 'Con avisos', 'Con errores'][worst],
      responseMs: pageMetrics?.responseMs ?? null,
    },
    reception: {
      lastMessageAt: inbox?.lastMessageAt ?? null,
      lastTestAt: inbox?.lastTestAt ?? null,
    },
    lastIncident: lastIncident ? { ...pick(lastIncident), status: lastIncident.resolvedAt ? 'resuelta' : 'abierta' } : null,
    incidents: state.incidents.slice(-5).reverse().map((i) => ({ ...pick(i), status: i.resolvedAt ? 'resuelta' : 'abierta' })),
  };
}

const pick = (i) => ({ openedAt: i.openedAt, resolvedAt: i.resolvedAt, severity: i.severity, summary: i.summary, components: i.components });
