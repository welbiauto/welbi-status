// B. Funcionamiento del formulario
// Que la página cargue no basta. Se combinan tres comprobaciones independientes:
//  1. estructura del HTML (campos, token, reCAPTCHA, scripts),
//  2. un envío vacío de control: el servidor debe responder pidiendo los campos
//     obligatorios (no se crea ninguna solicitud ni se envía ningún correo),
//  3. la página en un navegador real: el reCAPTCHA se pinta y el botón se ve (browser.mjs).
import { forms, anyElement } from '../lib/html.mjs';

export function findContactForm(html, requiredFields) {
  return forms(html).find((f) => requiredFields.some((n) => f.byName(n))) || null;
}

const isSubmit = (c) => (c.tag === 'button' && (c.attrs.type || 'submit') === 'submit') || (c.tag === 'input' && c.attrs.type === 'submit');
const isCaptcha = (c) => (c.attrs['data-sitekey'] || '').length > 0;

// 1 · Estructura
export async function inspectForm(cfg, http, page) {
  const out = { found: false, problems: [], warnings: [] };
  const form = findContactForm(page.html, cfg.requiredFields);
  if (!form) return out;
  out.found = true;

  if ((form.getAttribute('method') || 'get').toLowerCase() !== 'post') out.problems.push('método de envío incorrecto');
  const missing = cfg.requiredFields.filter((n) => !form.byName(n));
  if (missing.length) out.problems.push(`faltan campos (${missing.join(', ')})`);
  if (!form.find(isSubmit)) out.problems.push('no hay botón de envío');
  if (!form.byName('csrfmiddlewaretoken')?.getAttribute('value')) out.problems.push('falta el token de seguridad');
  if (!form.find(isCaptcha) && !anyElement(page.html, isCaptcha)) out.problems.push('no se carga el reCAPTCHA');

  if (!/recaptcha\/(api|enterprise)\.js/.test(page.html)) out.warnings.push('el script de reCAPTCHA no aparece en la página');
  if (!page.cookies.csrftoken) out.warnings.push('el servidor no ha emitido la cookie de seguridad');

  for (const asset of cfg.formAssets) {
    try {
      const r = await http.get(new URL(asset, cfg.origin).href);
      if (r.status >= 400) out.warnings.push(`el recurso ${asset} devuelve HTTP ${r.status}`);
    } catch {
      out.warnings.push(`el recurso ${asset} no responde`);
    }
  }
  return out;
}

// 2 · Envío vacío de control
// Se envía solo el token de seguridad, sin nombre, correo, mensaje ni reCAPTCHA.
// Un servidor sano lo rechaza mostrando de nuevo el formulario con los avisos de
// campos obligatorios. Así se comprueba que recibe y procesa envíos sin generar nada.
export async function emptySubmit(cfg, http, page) {
  const out = { problems: [], warnings: [], ok: false };
  const form = findContactForm(page.html, cfg.requiredFields);
  const csrf = form?.byName('csrfmiddlewaretoken')?.getAttribute('value');
  if (!form || !csrf || !page.cookies.csrftoken) return out; // ya lo señala la revisión de estructura

  try {
    const r = await http.request(cfg.contactUrl, {
      method: 'POST',
      redirect: 'manual',
      body: new URLSearchParams({ csrfmiddlewaretoken: csrf, website: '' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `csrftoken=${page.cookies.csrftoken}`,
        Referer: cfg.contactUrl,
        Origin: cfg.origin,
      },
    });
    if (r.status >= 500) out.problems.push(`el servidor da error al recibir envíos (HTTP ${r.status})`);
    else if (r.status === 403) out.problems.push('el servidor rechaza los envíos por seguridad (HTTP 403)');
    else if (r.status >= 300 && r.status < 400) out.warnings.push('el servidor dio por bueno un envío vacío (respuesta inesperada)');
    else if (r.status >= 400) out.warnings.push(`respuesta inesperada al enviar (HTTP ${r.status})`);
    else if (!findContactForm(r.text, cfg.requiredFields)) out.warnings.push('tras enviar, la página no vuelve a mostrar el formulario');
    else out.ok = true;
  } catch (err) {
    out.warnings.push(err.code === 'TIMEOUT' ? 'el envío de control no obtuvo respuesta a tiempo' : 'no se pudo completar el envío de control');
  }
  return out;
}

// Une las tres revisiones en el estado del indicador B
export function combineForm({ structure, submit, browser }) {
  if (!structure.found) {
    return { state: 'fail', summary: 'Formulario no encontrado', detail: 'La página carga, pero no contiene el formulario de contacto' };
  }
  const problems = [...structure.problems, ...(submit?.problems || []), ...(browser?.problems || [])];
  const warnings = [...structure.warnings, ...(submit?.warnings || []), ...(browser?.warnings || [])];

  if (problems.length) return { state: 'fail', summary: 'Formulario no operativo', detail: capitalize(problems.join('; ')) };
  if (warnings.length) return { state: 'warn', summary: 'Comportamiento anómalo', detail: capitalize(warnings.join('; ')) };

  const checks = ['campos y seguridad correctos'];
  if (browser && !browser.skipped) checks.push('reCAPTCHA visible en navegador');
  if (submit?.ok) checks.push('el servidor valida los envíos');
  return { state: 'ok', summary: 'Formulario disponible', detail: capitalize(checks.join(' · ')) };
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
