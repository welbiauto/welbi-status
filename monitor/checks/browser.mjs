// Parte del indicador B: abre la página en un Chromium sin interfaz y comprueba lo
// que solo se ve con JavaScript: que el reCAPTCHA se pinta, que el botón Enviar es
// visible y que la propia web no lanza errores. No escribe ni envía nada.
//
// Se bloquean Google Analytics, Tag Manager y los píxeles de anuncios para que estas
// visitas no cuenten en las estadísticas ni en las conversiones de Welbi.

const TRACKERS = /googletagmanager\.com|google-analytics\.com|doubleclick\.net|googleadservices\.com|facebook\.(net|com)\/tr|connect\.facebook\.net/;

export async function browserCheck(cfg) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { skipped: true, problems: [], warnings: [] };
  }

  const out = { skipped: false, problems: [], warnings: [] };
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    // Fallo del entorno del monitor, no de Welbi: se omite esta parte sin alarmar
    return { skipped: true, problems: [], warnings: [] };
  }
  try {
    const context = await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
    await context.route('**/*', (route) => (TRACKERS.test(route.request().url()) ? route.abort() : route.continue()));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));

    await page.goto(cfg.contactUrl, { waitUntil: 'load', timeout: cfg.timeoutMs * 2 });

    const captcha = await page
      .waitForSelector('iframe[src*="recaptcha"]', { state: 'attached', timeout: 15000 })
      .then(() => true, () => false);
    if (!captcha) out.problems.push('el reCAPTCHA no aparece al abrir la página en un navegador');

    const submitVisible = await page.locator('form button[type="submit"], form input[type="submit"]').first().isVisible().catch(() => false);
    if (!submitVisible) out.problems.push('el botón Enviar no se ve en el navegador');

    // Errores de la propia web (no de servicios externos)
    const own = errors.filter((e) => (e.stack || '').includes(cfg.origin.replace(/^https?:\/\//, '')));
    if (own.length) out.warnings.push(`la página lanza ${own.length} ${own.length === 1 ? 'error' : 'errores'} de JavaScript`);
  } catch (err) {
    out.warnings.push('no se pudo abrir la página en el navegador de comprobación');
  } finally {
    await browser.close();
  }
  return out;
}
