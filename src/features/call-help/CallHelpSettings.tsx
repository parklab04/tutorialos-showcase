import { useEffect, useId, useRef, useState } from 'react';
import { AppWindow } from 'lucide-react';
import { useCallHelpState } from './useCallHelpState';
import './call-suggestion.css';

// Home keeps this controller mounted while the same setting moves into Settings.
// An in-flight OS change therefore retains its busy guard across both views.
export function useCallHelpSettings() {
  const { state, error, apply, refresh } = useCallHelpState();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const [message, setMessage] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A fresh OS-confirmed setting supersedes an earlier failed write.
  useEffect(() => { setMessage(''); }, [state?.enabled, state?.status]);
  const act = async (operation: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage('');
    try { await operation(); }
    catch { if (mounted.current) setMessage('Could not update automatic help. Try again.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  const setEnabled = (enabled: boolean) => act(() => apply(() => window.helpOS!.setCallHelpEnabled(enabled)));
  const checkAgain = () => act(refresh);
  return { state, error, pending, message, setEnabled, checkAgain };
}

export type CallHelpSettingsModel = ReturnType<typeof useCallHelpSettings>;

export function CallHelpSettings({ desktop, model, variant = 'settings' }: { desktop: boolean; model: CallHelpSettingsModel; variant?: 'home' | 'settings' }) {
  const { state, error, pending, message, setEnabled, checkAgain } = model;
  const descriptionId = useId();
  const titleId = useId();
  const home = variant === 'home';
  const descriptions = {
    off: 'Automatic help is off.',
    watching: 'Help appears when an app opens or a FaceTime call starts.',
    permission: 'Automatic help is unavailable right now.',
    'requires-approval': 'Allow automatic help in Mac Login Items.',
    unavailable: 'Mac could not read this setting.',
  };
  const blocked = !state || pending || error || state.status === 'requires-approval' || state.status === 'unavailable' || state.status === 'permission';
  const label = pending ? 'Updating…' : error ? 'Unavailable' : !state ? 'Checking…' : state.status === 'requires-approval' ? 'Pending' : state.status === 'unavailable' || state.status === 'permission' ? 'Unavailable' : state.enabled ? 'On' : 'Off';
  const showStatus = !home || error || !state || !['off', 'watching'].includes(state.status);
  const Heading = home ? 'h2' : 'h3';
  return <section className={`${home ? 'automatic-help-home' : 'settings-section'} call-help-settings`} aria-labelledby={titleId} aria-busy={pending}>
    <div className="automatic-help-intro"><Heading id={titleId}><AppWindow size={21} aria-hidden="true" />Automatic help</Heading>
      <p id={home ? descriptionId : undefined} className="settings-note">{home ? 'Show guides when I open FaceTime, Safari, or Finder.' : 'FaceTime, Safari, and Finder.'}</p>
    </div>
    {!desktop ? <p className="automatic-help-status">Automatic help is available in the Mac app.</p> : <>
      <label className="call-help-toggle"><input type="checkbox" role="switch" aria-label="Show help when I open supported apps" aria-describedby={descriptionId} checked={!error && state?.status === 'watching' && state.enabled} disabled={blocked || !window.helpOS?.setCallHelpEnabled} onChange={event => { void setEnabled(event.target.checked); }} />{!home && <span>Show help when I open supported apps</span>}<strong aria-live="polite">{label}</strong></label>
      {!home && <p id={descriptionId} className="settings-note">FaceTime call detection needs Accessibility access.</p>}
      {showStatus && <p className="automatic-help-status" role="status">{error ? 'Could not check automatic help. Try again.' : state ? descriptions[state.status] : 'Checking automatic help…'}</p>}
      {error && <button className="button quiet" disabled={pending} onClick={() => void checkAgain()}>Check again</button>}
      {state?.status === 'requires-approval' && <button className="button quiet" disabled={pending || !window.helpOS?.setCallHelpEnabled} onClick={() => void setEnabled(false)}>Cancel request</button>}
      {state?.status === 'unavailable' && <button className="button quiet" disabled={pending || !window.helpOS?.setCallHelpEnabled} onClick={() => void setEnabled(true)}>Enable automatic help</button>}
      {message && <p className="notice" role="alert">{message}</p>}
    </>}
  </section>;
}
