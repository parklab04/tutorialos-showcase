import type { CallHelpState } from '../../../src/features/call-help/contracts';
import type { AppHelpController } from './controller';
import type { StartupSettings } from '../startup/startup';

// The opted-in LaunchAgent is the source of truth, not the old call-help.json
// default. A wake or status read can never register it or turn it back on.
export function createAppHelpService(controller: AppHelpController, registration: StartupSettings, publish: (state: CallHelpState) => void) {
  let status: CallHelpState['status'] = 'off';
  const decorate = (state: CallHelpState): CallHelpState => ({ ...state, status: state.enabled ? 'watching' : status });
  function refresh() {
    const observed = registration.get();
    status = observed.status === 'enabled' ? 'watching' : observed.status === 'requires-approval' ? 'requires-approval' : observed.status === 'off' ? 'off' : 'unavailable';
    if (controller.getState().enabled !== observed.enabled) controller.setEnabled(observed.enabled);
    return decorate(controller.getState());
  }
  function set(enabled: boolean) {
    // Disable in-flight UI work before unregistering the helper.
    if (!enabled) { status = 'off'; controller.setEnabled(false); }
    try { registration.set(enabled); }
    catch (error) { publish(refresh()); throw error; }
    const result = refresh(); publish(result); return result;
  }
  return { refresh, set, decorate };
}
