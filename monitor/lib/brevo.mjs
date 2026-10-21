// Consulta del registro de envíos transaccionales de Brevo (API v3, solo lectura).
// De cada evento solo se usan la fecha, el tipo y, si se configura, el asunto para filtrar.
// No se guardan ni se registran direcciones, asuntos ni contenidos.

const API = 'https://api.brevo.com/v3';

export function brevoConfigured(cfg) {
  return Boolean(cfg.brevo.apiKey);
}

const ymd = (d) => d.toISOString().slice(0, 10);

async function call(cfg, http, path) {
  const r = await http.request(`${API}${path}`, { headers: { 'api-key': cfg.brevo.apiKey, Accept: 'application/json' } });
  if (r.status === 401 || r.status === 403) {
    const e = new Error('La clave API de Brevo no es válida o no tiene permiso');
    e.code = 'BREVO_AUTH';
    throw e;
  }
  if (r.status >= 400) {
    const e = new Error(`Brevo respondió HTTP ${r.status}`);
    e.code = 'BREVO_HTTP';
    throw e;
  }
  return JSON.parse(r.text || '{}');
}

// Devuelve un resumen sin datos personales:
// { lastSentAt, lastDeliveredAt, sentSince, failures: {hard, blocked, soft}, lastFailureReason, credits }
export async function inspectBrevo(cfg, http, { now = new Date(), since = null } = {}) {
  const start = new Date(now.getTime() - cfg.lookbackDays * 86400000);
  const params = new URLSearchParams({ startDate: ymd(start), endDate: ymd(now), limit: '2500', sort: 'desc' });
  if (cfg.brevo.to) params.set('email', cfg.brevo.to);

  const { events = [] } = await call(cfg, http, `/smtp/statistics/events?${params}`);
  const subject = cfg.brevo.subject.toLowerCase();
  const relevant = events.filter((e) => !subject || String(e.subject || '').toLowerCase().includes(subject));

  const times = (type) => relevant.filter((e) => e.event === type).map((e) => new Date(e.date).getTime()).filter(Number.isFinite);
  const latest = (list) => (list.length ? new Date(Math.max(...list)).toISOString() : null);

  const sent = times('requests');
  const delivered = times('delivered');
  // Fallos de entrega en el periodo vigilado (desde la comprobación anterior, o los últimos días)
  const windowStart = since ? new Date(since).getTime() : now.getTime() - cfg.checkEveryHours * 3600000;
  const inWindow = (type) => relevant.filter((e) => e.event === type && new Date(e.date).getTime() >= windowStart);
  const hard = [...inWindow('hardBounces'), ...inWindow('invalid'), ...inWindow('error')];
  const blocked = [...inWindow('blocked'), ...inWindow('spam')];
  const soft = [...inWindow('softBounces'), ...inWindow('deferred')];

  // Créditos de envío (si la cuenta los informa)
  let credits = null;
  try {
    const account = await call(cfg, http, '/account');
    const plan = (account.plan || []).find((p) => p.creditsType === 'sendLimit' || p.type === 'payAsYouGo' || p.type === 'free');
    if (plan && Number.isFinite(plan.credits)) credits = plan.credits;
  } catch {
    // los créditos son informativos: si no se pueden leer, se sigue
  }

  return {
    lastSentAt: latest(sent),
    lastDeliveredAt: latest(delivered),
    sentSince: since ? sent.some((t) => t > new Date(since).getTime()) : null,
    failures: { hard: hard.length, blocked: blocked.length, soft: soft.length },
    credits,
    truncated: events.length >= 2500,
  };
}
