// Lectura en SOLO LECTURA del buzón donde llegan las solicitudes del formulario.
// El buzón se abre en modo lectura (no marca nada como leído ni mueve mensajes) y solo
// se descargan fechas: ni asuntos, ni remitentes, ni contenidos. Las búsquedas por
// remitente, asunto o texto las hace el propio servidor de correo.

export function imapConfigured(cfg) {
  return Boolean(cfg.imap.host && cfg.imap.user && cfg.imap.pass);
}

export function formMailConfigured(cfg) {
  return Boolean(cfg.formMailFrom || cfg.formMailSubject);
}

// Devuelve { lastMessageAt, lastTestAt, autoresponseAt } (ISO o null)
export async function inspectInbox(cfg, now = new Date()) {
  const { ImapFlow } = await import('imapflow'); // carga diferida
  const client = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: true,
    auth: { user: cfg.imap.user, pass: cfg.imap.pass },
    logger: false,
  });
  const since = new Date(now.getTime() - cfg.lookbackDays * 86400000);
  const base = { since };
  if (cfg.formMailFrom) base.from = cfg.formMailFrom;
  if (cfg.formMailSubject) base.subject = cfg.formMailSubject;

  const result = { lastMessageAt: null, lastTestAt: null, autoresponseAt: null };
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.imap.mailbox, { readOnly: true });
    try {
      result.lastMessageAt = await latestDate(client, base);
      if (cfg.testMarker) result.lastTestAt = await latestDate(client, { ...base, body: cfg.testMarker });

      if (cfg.autoresponseSubject && result.lastTestAt) {
        const testAt = new Date(result.lastTestAt);
        const uids = await client.search({ since: new Date(testAt.getTime() - 86400000), subject: cfg.autoresponseSubject }, { uid: true });
        const limit = testAt.getTime() + cfg.autoresponseWindowMin * 60000;
        for (const d of await dates(client, uids)) {
          // la respuesta automática tiene que llegar después de la prueba y dentro del plazo
          if (d >= testAt.getTime() - 60000 && d <= limit && (!result.autoresponseAt || d < new Date(result.autoresponseAt).getTime())) {
            result.autoresponseAt = new Date(d).toISOString();
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return result;
}

async function latestDate(client, query) {
  const uids = await client.search(query, { uid: true });
  const all = await dates(client, uids);
  return all.length ? new Date(Math.max(...all)).toISOString() : null;
}

async function dates(client, uids) {
  if (!uids || !uids.length) return [];
  const out = [];
  for await (const msg of client.fetch(uids, { internalDate: true }, { uid: true })) {
    if (msg.internalDate) out.push(new Date(msg.internalDate).getTime());
  }
  return out;
}
