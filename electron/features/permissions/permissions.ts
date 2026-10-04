import type { PermissionKind, PermissionRequestResult } from '../../../src/features/permissions/contracts';

interface PermissionDependencies {
  readPermission(kind: PermissionKind): Promise<boolean>;
  requestNative(kind: PermissionKind): Promise<void>;
  openSettings(kind: PermissionKind): Promise<void>;
}

export function createPermissionRequester(deps: PermissionDependencies) {
  const pending = new Map<PermissionKind, Promise<PermissionRequestResult>>();
  let queue: Promise<void> = Promise.resolve();

  async function request(kind: PermissionKind): Promise<PermissionRequestResult> {
    if (await deps.readPermission(kind)) return { granted: true, settingsOpened: false };
    try {
      await deps.requestNative(kind);
    } catch {
      // A rejected capture request can mean consent was denied. Recheck below.
    }
    if (await deps.readPermission(kind)) return { granted: true, settingsOpened: false };
    await deps.openSettings(kind);
    return { granted: false, settingsOpened: true };
  }

  return (kind: PermissionKind): Promise<PermissionRequestResult> => {
    const existing = pending.get(kind);
    if (existing) return existing;
    // Keep different permission dialogs from overlapping across app windows.
    const result = queue.then(() => request(kind)).finally(() => pending.delete(kind));
    pending.set(kind, result);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
