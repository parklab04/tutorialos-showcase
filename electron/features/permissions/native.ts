import { desktopCapturer, shell, systemPreferences } from 'electron';
import type { PermissionKind } from '../../../src/features/permissions/contracts';
import { createPermissionRequester } from './permissions';

// OS permission status does not depend on loading or traversing an app's UI.
// Never turn an observer failure into a denied permission or prompt automatically.
export function readNativePermission(kind: PermissionKind): boolean {
  if (kind === 'accessibility') return systemPreferences.isTrustedAccessibilityClient(false);
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'unknown') throw new Error('HelpOS could not check Screen Recording access.');
  return status === 'granted';
}

export function createNativePermissionRequester() {
  // Only the explicit permission-button IPC invokes this request path. Status and
  // observation remain read-only and never prompt on their own.
  return createPermissionRequester({
    readPermission: async kind => readNativePermission(kind),
    requestNative: async kind => {
      if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
      else {
        // Electron 44 prompts before processing thumbnails. Zero dimensions avoid
        // creating screen images while registering the screen-access request.
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      }
    },
    openSettings: async kind => {
      const pane = kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
      await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
    },
  });
}
