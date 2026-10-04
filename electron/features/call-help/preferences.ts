import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CallHelpState } from '../../../src/features/call-help/contracts';
import type { CallHelpMonitor } from './call-help';

export function createCallHelpPreferences(callHelp: CallHelpMonitor, getDirectory: () => string) {
  let preferenceWrite = Promise.resolve();
  let preferenceRevision = 0;
  async function readCallHelpPreference(): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(path.join(getDirectory(), 'call-help.json'), 'utf8'));
      return z.object({ enabled: z.boolean() }).parse(value).enabled;
    } catch { return true; }
  }
  function setCallHelpPreference(enabled: boolean): Promise<CallHelpState> {
    const revision = ++preferenceRevision;
    // Off takes effect before disk I/O, even behind an earlier queued enable.
    if (!enabled) callHelp.setEnabled(false);
    const operation = preferenceWrite.then(async () => {
      const directory = getDirectory();
      await mkdir(directory, { recursive: true });
      const filename = path.join(directory, 'call-help.json');
      await writeFile(filename + '.tmp', JSON.stringify({ enabled }) + '\n', { mode: 0o600 });
      await rename(filename + '.tmp', filename);
      if (revision === preferenceRevision) callHelp.setEnabled(enabled);
    });
    preferenceWrite = operation.catch(() => {});
    return operation.then(() => callHelp.getState());
  }
  return { read: readCallHelpPreference, set: setCallHelpPreference };
}
export type CallHelpPreferences = ReturnType<typeof createCallHelpPreferences>;
