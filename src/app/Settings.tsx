import { useEffect, useRef } from 'react';
import { Settings2, ShieldCheck, X } from 'lucide-react';
import { copy } from '../shared/copy';
import type { AppStatus } from '../shared/bridge';
import { PermissionSetup } from '../features/permissions/PermissionSetup';
import { CallHelpSettings } from '../features/call-help/CallHelpSettings';
import type { CallHelpSettingsModel } from '../features/call-help/CallHelpSettings';
import { AISettings } from '../features/ai/AISettings';

export function Settings({ status, scale, setScale, refresh, automaticHelp, onClose }: { status: AppStatus; scale: number; setScale: (scale: number) => void; refresh: () => Promise<void>; automaticHelp: CallHelpSettingsModel; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose}>
    <div className="modal-header"><h2 id="settings-title"><Settings2 size={25} />{copy.settings.title}</h2><button className="icon-button" onClick={onClose} aria-label={copy.settings.close}><X size={23} /></button></div>
    <div className="modal-body">
      <section className="settings-section"><h3>{copy.settings.textSize}</h3><div className="size-options" role="group" aria-label={copy.settings.textSize}>{[{ value: 1, label: 'Default' }, { value: 1.25, label: 'Large' }, { value: 1.5, label: 'Larger' }, { value: 2, label: 'Largest' }].map(item => <button key={item.value} className={`button ${scale === item.value ? 'selected' : 'secondary'}`} aria-pressed={scale === item.value} onClick={() => setScale(item.value)}>{item.label}</button>)}</div></section>
      <CallHelpSettings desktop={status.desktop} model={automaticHelp} />
      <section className="settings-section"><h3><ShieldCheck size={21} />{copy.settings.permissions}</h3>{!status.desktop ? <p>{copy.error.desktopOnlyTitle}</p> : <><PermissionSetup accessibility={status.accessibility} screenCapture={status.screenCapture} onRefresh={refresh} /><button className="button quiet" onClick={() => void refresh()}>{copy.permissions.checkAgain}</button></>}</section>
      <AISettings status={status} refresh={refresh} />
    </div>
    <div className="modal-footer"><button className="button primary" onClick={onClose}>{copy.settings.close}</button></div>
  </dialog>;
}
