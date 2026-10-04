import type { StartupState } from '../../../src/features/startup/contracts';

export interface LoginSettings {
  openAtLogin: boolean;
  status: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found';
}
interface Options {
  available(): boolean;
  read(): LoginSettings;
  write(enabled: boolean): void;
}
// macOS owns this preference. Reading or starting the app never registers it,
// and an external disable must not be undone by an app restart.
export function createStartupSettings(options: Options) {
  function get(): StartupState {
    if (!options.available()) return { available: false, enabled: false, status: 'unavailable' };
    try {
      const value = options.read();
      const status = value.status === 'requires-approval' ? 'requires-approval' : value.status === 'not-found' ? 'unavailable' : value.openAtLogin && value.status === 'enabled' ? 'enabled' : 'off';
      return { available: true, enabled: status === 'enabled', status };
    } catch { return { available: true, enabled: false, status: 'unavailable' }; }
  }
  function set(enabled: boolean): StartupState {
    if (!options.available()) throw new Error('Open the installed Mac app to change automatic help.');
    options.write(enabled);
    const state = get();
    if (state.status === 'unavailable' || (enabled && state.status === 'off') || (!enabled && state.status !== 'off')) {
      throw new Error('Mac settings did not confirm the change.');
    }
    return state;
  }
  return { get, set };
}
export type StartupSettings = ReturnType<typeof createStartupSettings>;
