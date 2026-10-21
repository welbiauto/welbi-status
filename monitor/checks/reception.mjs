// C. Envío y recepción de mensajes  ·  D. Automatizaciones y notificaciones
// Verificación pasiva: se confirma con las solicitudes reales y con las pruebas manuales
// marcadas "[PRUEBA]" que llegan al buzón. No se envía nada desde el monitor.

const DAY = 86400000;
const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const when = (iso) => fmt.format(new Date(iso)).replace(',', ' a las');
const days = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;

export function evaluateReception(cfg, inbox, now = new Date()) {
  if (inbox.status === 'not_configured') {
    return { state: 'unknown', summary: 'Recepción no verificada', detail: 'El buzón de solicitudes no está configurado en el monitor' };
  }
  if (inbox.status === 'error') {
    return { state: 'unknown', cause: 'monitor', summary: 'Recepción no comprobable', detail: 'El monitor no ha podido leer el buzón; no es necesariamente un fallo de Welbi' };
  }
  const { lastMessageAt, lastTestAt } = inbox;

  if (!lastMessageAt) {
    return {
      state: 'fail',
      summary: 'No llegan solicitudes',
      detail: `No ha llegado ninguna solicitud del formulario en ${days(cfg.lookbackDays)}. Haz un envío de prueba para confirmarlo`,
    };
  }
  const ageDays = Math.floor((now - new Date(lastMessageAt)) / DAY);
  if (ageDays < cfg.expectedDays) {
    return { state: 'ok', summary: 'Las solicitudes llegan con normalidad', detail: `Ha llegado al menos una en los últimos ${days(cfg.expectedDays)}` };
  }
  if (ageDays < cfg.failAfterDays) {
    return {
      state: 'warn',
      summary: 'Sin solicitudes recientes',
      detail: `La última llegó hace ${days(ageDays)}. Puede ser poco tráfico: un envío de prueba lo confirma`,
    };
  }
  return {
    state: 'fail',
    summary: 'Sin solicitudes en muchos días',
    detail: `La última llegó hace ${days(ageDays)} (límite: ${days(cfg.failAfterDays)}). Revisa el formulario con un envío de prueba`,
  };
}

export function evaluateAutomations(cfg, inbox, now = new Date()) {
  if (!cfg.autoresponseSubject) {
    return { state: 'unknown', summary: 'Sin verificación automática', detail: 'No hay ninguna automatización configurada para comprobar' };
  }
  if (inbox.status !== 'ok') {
    return { state: 'unknown', cause: inbox.status === 'error' ? 'monitor' : undefined, summary: 'Sin datos', detail: 'No se ha podido consultar el buzón' };
  }
  const { lastTestAt, autoresponseAt } = inbox;
  if (!lastTestAt) {
    return { state: 'unknown', summary: 'Pendiente de prueba manual', detail: `Se verificará con el próximo envío marcado ${cfg.testMarker}` };
  }
  if (autoresponseAt) {
    const secs = Math.max(1, Math.round((new Date(autoresponseAt) - new Date(lastTestAt)) / 1000));
    const wait = secs < 120 ? `${secs} s` : `${Math.round(secs / 60)} min`;
    return { state: 'ok', summary: 'Respuesta automática correcta', detail: `En la última prueba manual llegó en ${wait}` };
  }
  const minsSinceTest = (now - new Date(lastTestAt)) / 60000;
  if (minsSinceTest < cfg.autoresponseWindowMin) {
    return { state: 'warn', pending: true, summary: 'Esperando respuesta automática', detail: 'Hay una prueba manual reciente en curso' };
  }
  return {
    state: 'fail',
    summary: 'La respuesta automática no llegó',
    detail: `En la última prueba manual no llegó en ${cfg.autoresponseWindowMin} min`,
  };
}
