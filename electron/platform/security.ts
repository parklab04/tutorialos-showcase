import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { Renderer } from './renderer';

export type WindowRole = 'home' | 'coach' | 'overlay' | 'call-help' | 'voice';
export function createWindowSecurity({ ownPage }: Renderer, handleEscape: (role: WindowRole) => boolean) {
  const roles = new Map<number, WindowRole>();
  function authorize(event: IpcMainInvokeEvent, accepted: WindowRole[] = ['home', 'coach']): void {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !accepted.includes(roles.get(event.sender.id)!) || !ownPage(event.senderFrame.url)) throw new Error('This request is not allowed.');
  }
  function secureWindow(window: BrowserWindow, role: WindowRole) {
    const contentsId = window.webContents.id;
    roles.set(contentsId, role);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!ownPage(url)) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape' && handleEscape(role)) event.preventDefault(); });
    window.webContents.once('destroyed', () => roles.delete(contentsId));
  }
  return { authorize, secureWindow, roleOf: (contentsId: number) => roles.get(contentsId) };
}
export type WindowSecurity = ReturnType<typeof createWindowSecurity>;
