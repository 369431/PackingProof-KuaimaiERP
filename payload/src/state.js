import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const statePath = resolve('.state.json');

export async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(statePath, 0o600);
}
