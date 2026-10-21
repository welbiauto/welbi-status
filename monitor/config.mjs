// Configuración del monitor. Todo se lee de variables de entorno
// (en GitHub Actions: Settings → Secrets and variables → Actions).
//
// Modo de trabajo: sin acceso al backend de Welbi. El monitor
//  · revisa la página y el formulario desde fuera (HTML, navegador real y un envío vacío de control),
//  · y confirma la recepción leyendo en solo lectura el buzón donde llegan las solicitudes.

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase()));
const str = (v, d = '') => (v === undefined || v === '' ? d : v);

export function loadConfig(overrides = {}) {
  const contactUrl = str(env.CONTACT_URL, 'https://www.welbi.es/contacto/');
  const checkEveryHours = num(env.CHECK_EVERY_HOURS, 72);
  return {
    contactUrl,
    origin: new URL(contactUrl).origin,

    // Formulario
    requiredFields: str(env.REQUIRED_FIELDS, 'nombre,email,mensaje,acepta_politica').split(',').map((s) => s.trim()),
    formAssets: str(env.FORM_ASSETS, '/static/scripts/website.js').split(',').map((s) => s.trim()).filter(Boolean),
    emptySubmitCheck: bool(env.EMPTY_SUBMIT_CHECK, true),
    browserCheck: bool(env.BROWSER_CHECK, true),

    // Brevo (preferente): registro de envíos transaccionales, solo lectura
    brevo: {
      apiKey: str(env.BREVO_API_KEY),
      to: str(env.BREVO_TO),           // opcional: dirección que recibe los avisos del formulario
      subject: str(env.BREVO_SUBJECT), // opcional: texto del asunto de los avisos
      lowCredits: num(env.BREVO_LOW_CREDITS, 20),
    },

    // Resumen semanal por correo (se envía con Brevo)
    report: {
      reportTo: str(env.REPORT_TO),
      reportFrom: str(env.REPORT_FROM),             // remitente verificado en Brevo
      reportFromName: str(env.REPORT_FROM_NAME, 'Estado del formulario · Welbi'),
      panelUrl: str(env.PANEL_URL, 'https://welbiauto.github.io/welbi-status/'),
    },

    // Buzón donde llegan los avisos del formulario (alternativa a Brevo, solo lectura)
    imap: {
      host: str(env.IMAP_HOST),
      port: num(env.IMAP_PORT, 993),
      user: str(env.IMAP_USER),
      pass: str(env.IMAP_PASSWORD),
      mailbox: str(env.IMAP_MAILBOX, 'INBOX'),
    },
    // Cómo reconocer un aviso del formulario (basta con uno de los dos)
    formMailFrom: str(env.FORM_MAIL_FROM),
    formMailSubject: str(env.FORM_MAIL_SUBJECT),
    // Marca que el equipo escribe en el mensaje al hacer una prueba manual
    testMarker: str(env.TEST_MARKER, '[PRUEBA]'),
    // Asunto de la respuesta automática al cliente (vacío = no se verifica)
    autoresponseSubject: str(env.AUTORESPONSE_SUBJECT),
    autoresponseWindowMin: num(env.AUTORESPONSE_WINDOW_MIN, 60),
    lookbackDays: num(env.LOOKBACK_DAYS, 30),
    expectedDays: num(env.EXPECTED_DAYS, 4),     // hasta aquí sin solicitudes: normal
    failAfterDays: num(env.FAIL_AFTER_DAYS, 10), // a partir de aquí: incidencia

    // Tiempos
    slowMs: num(env.SLOW_MS, 2500),
    timeoutMs: num(env.TIMEOUT_MS, 15000),
    retries: num(env.RETRIES, 3),
    retryDelayMs: num(env.RETRY_DELAY_MS, 3000),
    // Si algo falla, se vuelve a comprobar pasado este tiempo antes de declarar la incidencia
    confirmDelayMs: num(env.CONFIRM_DELAY_MS, 120000),
    checkEveryHours,
    // El panel avisa si no recibe datos nuevos en este tiempo (por defecto, 3 días + 1 de margen)
    staleAfterMin: num(env.STALE_AFTER_MIN, (checkEveryHours + 24) * 60),
    automationsCritical: bool(env.AUTOMATIONS_CRITICAL, false),

    // URL neutra para distinguir "Welbi caído" de "el monitor no tiene red"
    controlUrl: str(env.CONTROL_URL, 'https://www.gstatic.com/generate_204'),
    // Enlace "Comprobar ahora" del panel (lo rellena GitHub Actions)
    runUrl: env.GITHUB_REPOSITORY ? `${str(env.GITHUB_SERVER_URL, 'https://github.com')}/${env.GITHUB_REPOSITORY}/actions/workflows/monitor.yml` : '',

    statePath: str(env.STATE_PATH, '.state/state.json'),
    statusPath: str(env.STATUS_PATH, '.state/status.json'),
    ...overrides,
  };
}
