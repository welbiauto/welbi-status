// Estado persistente entre ejecuciones (se guarda en la rama status-data).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function emptyState() {
  return { version: 2, components: {}, incidents: [], history: [] };
}

export async function loadState(path) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return { ...emptyState(), incidents: raw.incidents || [], history: raw.history || [], components: raw.components || {} };
  } catch {
    return emptyState();
  }
}

export async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
