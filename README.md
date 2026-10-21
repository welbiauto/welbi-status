# Estado del formulario de contacto de Welbi

Panel de estado (landing) y monitor independiente para el formulario de
https://www.welbi.es/contacto/. Funciona **sin tocar el backend de Welbi** y comprueba
el sistema **cada 3 días**, con un botón para comprobar en cualquier momento.

```
GitHub Actions, cada 3 días o a demanda
  ├─ A  GET /contacto/ ............................ welbi.es
  ├─ B  revisa el HTML del formulario
  │     POST vacío de control (no crea solicitudes) ─ welbi.es
  │     abre la página en un navegador real
  ├─ C  fechas de los avisos del formulario ....... buzón (solo lectura)
  ├─ D  respuesta automática de la última prueba .. buzón (solo lectura)
  └─ publica status.json + landing ................ GitHub Pages
```

El monitor no se ejecuta en welbi.es, así que el panel sigue funcionando aunque la web caiga.

## Qué contiene

| Ruta | Qué es |
|---|---|
| `site/index.html` | Landing. Lee `data/status.json`. Sin dependencias. |
| `monitor/` | Monitor en Node 22. `run.mjs` hace una ejecución completa. |
| `monitor/test/` | Pruebas de los escenarios (caída, fallo intermitente, error al enviar, días sin solicitudes…). |
| `.github/workflows/monitor.yml` | Ejecuta el monitor cada 3 días y publica la landing en GitHub Pages. |
| `site/data/demo.json` | Escenarios de ejemplo; la landing los usa solo si no hay `status.json`. |

## Los cuatro indicadores

| | Verde | Naranja | Rojo | Gris (sin datos) |
|---|---|---|---|---|
| **A · Página** | HTTP 2xx en menos de 2,5 s | Lenta, contenido extraño o fallo intermitente | Inaccesible o con error, confirmado al repetir la comprobación | El monitor no tiene conexión |
| **B · Formulario** | Campos, token y reCAPTCHA presentes; el reCAPTCHA se ve en un navegador; el servidor responde bien al envío de control | Falta la cookie de seguridad o un script, el servidor acepta un envío vacío, errores de JavaScript | Falta el formulario, un campo, el botón o el reCAPTCHA, o el servidor da error al recibir envíos | La página no carga |
| **C · Recepción** | Ha llegado al menos una solicitud en los últimos 4 días | Entre 4 y 10 días sin solicitudes | Más de 10 días sin solicitudes | Buzón sin configurar o inaccesible |
| **D · Respuesta automática** | Llegó en la última prueba manual | Prueba manual en curso | No llegó en la última prueba manual | No configurada o sin pruebas manuales |

**Estado general**: rojo si falla A, B o C; naranja si hay avisos o algún control crítico sin
verificar; verde solo si A, B y C están en verde. D aparece en gris si no se usa, sin impedir
el verde (salvo con `AUTOMATIONS_CRITICAL=true`).

**Falsas alarmas**: la página se reintenta 3 veces. Si aun así A o B fallan, el monitor espera
2 minutos y repite todo: solo es rojo si vuelve a fallar; si se recupera, queda en naranja como
«Fallo intermitente». Si el monitor no tiene conexión o no puede leer el buzón, el panel lo
muestra en gris («monitor»), no como una caída de Welbi.

**Datos caducados**: si el panel no recibe resultados en 4 días (3 días + 1 de margen), todo
pasa a gris con un aviso, aunque lo último recibido fuera verde.

**Incidencias**: se abre una cuando el estado pasa a naranja o rojo por un fallo real y se cierra
al volver a verde. Se guardan las 20 últimas; la landing muestra las 5 últimas.

## Recepción con Brevo (recomendado)

Si la web envía los avisos del formulario a través de Brevo, el monitor consulta en solo lectura
el registro de envíos transaccionales de Brevo:

- **C · Envío y recepción**: verde si Brevo ha enviado y entregado avisos en los últimos 4 días;
  rojo si alguno ha rebotado o se ha bloqueado desde la comprobación anterior; naranja si hay
  reintentos o si llevan entre 4 y 10 días sin solicitudes.
- **D · Notificaciones**: verde si Brevo está operativo con envíos disponibles; naranja si quedan
  pocos; rojo si se ha agotado el saldo o el límite de envíos.
- **Aviso de solicitudes nuevas**: si desde la comprobación anterior han llegado solicitudes de
  presupuesto, el panel muestra un aviso. No se publican cifras, direcciones ni asuntos.

Configuración en *Settings → Secrets and variables → Actions*:

| Tipo | Nombre | Para qué |
|---|---|---|
| Secreto | `BREVO_API_KEY` | Clave API de Brevo (*SMTP y API → Claves API*) |
| Variable (opcional) | `BREVO_TO` | Dirección que recibe los avisos del formulario, si Brevo envía también otros correos |
| Variable (opcional) | `BREVO_SUBJECT` | Texto del asunto de los avisos, como alternativa a `BREVO_TO` |

Si `BREVO_API_KEY` está configurada se usa Brevo; si no, el buzón por IMAP (apartado siguiente).

## Cómo se comprueba la recepción sin tocar el backend

El monitor se conecta por IMAP **en solo lectura** al buzón donde llegan las solicitudes
(por ejemplo, `hola@welbi.es`) y busca los avisos del formulario por remitente o asunto.
Solo descarga **fechas**: ni asuntos, ni remitentes, ni contenidos, y no marca nada como leído.

- **Solicitudes reales**: si llegan con normalidad, la recepción está confirmada.
- **Prueba manual**: cuando haya pocos mensajes, o tras un cambio en la web, alguien del equipo
  envía el formulario escribiendo `[PRUEBA]` en el mensaje. Para que también se compruebe la
  respuesta automática, en el campo de correo hay que poner **la dirección del propio buzón
  vigilado**, así la respuesta llega donde el monitor la puede ver.

## Puesta en marcha

### 1. Datos del buzón

Hace falta saber:
- Servidor IMAP del buzón donde llegan las solicitudes (Gmail / Google Workspace: `imap.gmail.com`).
- Usuario y **contraseña de aplicación** (en Google: Cuenta → Seguridad → Contraseñas de aplicaciones).
- Cómo reconocer un aviso del formulario: el remitente (p. ej. `no-reply@welbi.es`) o un trozo del
  asunto (p. ej. `Nueva solicitud`). Se ve abriendo cualquier aviso recibido.
- Si hay respuesta automática al cliente, un trozo de su asunto (p. ej. `Gracias por contactar`).

Si no se quiere dar acceso a ese buzón, se puede crear uno técnico y una regla en el correo que
le reenvíe una copia de los avisos del formulario (y de las respuestas automáticas de las pruebas).

### 2. Repositorio en GitHub

1. Subir esta carpeta a un repositorio nuevo (público o privado; con privado, GitHub Pages
   requiere un plan de pago).
2. *Settings → Pages → Source: GitHub Actions*.
3. *Settings → Secrets and variables → Actions*:

   | Tipo | Nombre | Ejemplo |
   |---|---|---|
   | Secreto | `IMAP_HOST` | `imap.gmail.com` |
   | Secreto | `IMAP_USER` | `hola@welbi.es` |
   | Secreto | `IMAP_PASSWORD` | contraseña de aplicación |
   | Variable | `FORM_MAIL_FROM` | `no-reply@welbi.es` |
   | Variable | `FORM_MAIL_SUBJECT` | `Nueva solicitud` (opcional si hay remitente) |
   | Variable | `AUTORESPONSE_SUBJECT` | `Gracias por contactar` (opcional) |

   Opcionales: `EXPECTED_DAYS` (4), `FAIL_AFTER_DAYS` (10), `TEST_MARKER` (`[PRUEBA]`),
   `IMAP_MAILBOX` (`INBOX`), `SLOW_MS` (2500), `AUTOMATIONS_CRITICAL` (`false`).
4. *Actions → Monitor formulario Welbi → Run workflow*. En unos 2 minutos el panel estará
   publicado en la dirección que indica *Settings → Pages*.

Con un dominio propio (p. ej. `estado.welbi.es`) se configura en *Settings → Pages → Custom domain*.

**Comprobar ahora**: el botón del panel lleva a la página del workflow en GitHub, donde una
persona con acceso al repositorio pulsa *Run workflow*. El panel se actualiza al terminar.

Sin los datos del buzón el monitor ya funciona: A y B son reales y C aparece como «no verificada».

## Privacidad

- La landing solo muestra estados, fechas y textos genéricos.
- El envío vacío de control lleva únicamente el token de seguridad: no tiene nombre, correo,
  mensaje ni reCAPTCHA, así que el servidor lo rechaza sin crear ninguna solicitud ni enviar correos.
- El navegador de comprobación bloquea Google Analytics, Tag Manager y píxeles de anuncios,
  así que estas visitas no cuentan en las estadísticas ni en las conversiones.
- Del buzón solo se leen fechas. Ni el estado público ni el interno guardan direcciones de correo
  (hay una prueba automática que lo comprueba).
- Credenciales solo en *GitHub Secrets*.

## Límites

- Con una comprobación cada 3 días, una caída se ve como mucho 3 días después
  (o al pulsar *Comprobar ahora*).
- La recepción es pasiva: si Welbi pasa más de 4 días sin solicitudes, el indicador C se pone
  en naranja aunque todo funcione. Una prueba manual lo vuelve a verde.
- En repositorios sin actividad durante 60 días GitHub puede desactivar los workflows
  programados; avisa por correo antes y se reactivan con un clic.

## Desarrollo

```bash
npm test          # escenarios del monitor (no necesita red)
npm run demo      # regenera site/data/demo.json con el monitor real sobre un welbi.es simulado
npm run monitor   # ejecución real (configuración por variables de entorno)
```

Para ver la landing en local: `npx serve site` y abrir `http://localhost:3000`
(sin `status.json` muestra los escenarios de ejemplo con un selector).
