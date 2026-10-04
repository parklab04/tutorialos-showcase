import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Bookmark, Camera, ChevronRight, Compass, FolderOpen, Mic, PhoneOff, RotateCcw, Video, X, ZoomIn } from 'lucide-react';
import type { LessonId } from '../lessons/types';
import type { SupportedApp } from './contracts';
import { useCallHelpState } from './useCallHelpState';
import './call-suggestion.css';

const apps: Record<SupportedApp, { name: string; icon: typeof Mic; choices: Array<{ id: LessonId; label: string; accessible: string; icon: typeof Mic }> }> = {
  facetime: { name: 'FaceTime', icon: Video, choices: [
    { id: 'facetime-mic', label: 'Mute or unmute', accessible: 'Learn about microphone', icon: Mic },
    { id: 'facetime-camera', label: 'Camera on or off', accessible: 'Learn about camera', icon: Camera },
    { id: 'facetime-end', label: 'Leave a call', accessible: 'Learn about leave call', icon: PhoneOff },
  ] },
  safari: { name: 'Safari', icon: Compass, choices: [
    { id: 'safari-zoom', label: 'Make text larger', accessible: 'Make text larger', icon: ZoomIn },
    { id: 'safari-reader', label: 'Remove distractions', accessible: 'Remove distractions', icon: BookOpen },
    { id: 'safari-bookmark', label: 'Save this page', accessible: 'Save this page', icon: Bookmark },
    { id: 'safari-reopen-tab', label: 'Reopen a tab', accessible: 'Reopen a tab', icon: RotateCcw },
  ] },
  finder: { name: 'Finder', icon: FolderOpen, choices: [{ id: 'finder-downloads', label: 'Find Downloads', accessible: 'Find Downloads', icon: FolderOpen }] },
};

export function CallSuggestion({ scale }: { scale: number }) {
  const { state, error, apply } = useCallHelpState();
  const content = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [actionError, setActionError] = useState('');
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const dismissBusy = useRef(false);
  const actionRevision = useRef(0);
  useEffect(() => { actionRevision.current++; busy.current = false; dismissBusy.current = false; setPending(false); setActionError(''); setDismissedId(null); }, [state?.suggestion?.id]);
  const act = useCallback(async (operation: () => Promise<unknown>) => {
    if (busy.current || dismissBusy.current) return;
    busy.current = true; setPending(true); setActionError('');
    const current = actionRevision.current;
    try { await operation(); }
    catch { if (actionRevision.current === current) setActionError('Try again or close help.'); }
    finally { if (actionRevision.current === current) { busy.current = false; setPending(false); } }
  }, []);
  const dismiss = useCallback(async () => {
    if (dismissBusy.current) return;
    dismissBusy.current = true;
    const current = ++actionRevision.current;
    busy.current = false; setPending(false); setActionError('');
    setDismissedId(state?.suggestion?.id ?? null);
    try {
      if (!window.helpOS?.dismissCallHelp) throw new Error('Call help unavailable');
      await window.helpOS.dismissCallHelp();
    } catch {
      if (actionRevision.current === current) { setDismissedId(null); setActionError('Could not close. Try again.'); }
    } finally { if (actionRevision.current === current) dismissBusy.current = false; }
  }, [state?.suggestion?.id]);
  useEffect(() => {
    document.documentElement.classList.add('call-help-document');
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void dismiss(); } };
    window.addEventListener('keydown', key);
    return () => { document.documentElement.classList.remove('call-help-document'); window.removeEventListener('keydown', key); };
  }, [dismiss]);
  useEffect(() => {
    void window.helpOS?.reportCallHelpScale?.(scale)?.catch(() => setActionError('Could not resize help.'));
  }, [scale]);
  useLayoutEffect(() => {
    if (!content.current) return;
    let previous = 0;
    const report = () => {
      if (!content.current) return;
      const height = Math.ceil(content.current.getBoundingClientRect().height + 14);
      if (height === previous) return;
      previous = height;
      void window.helpOS?.reportCallHelpHeight?.(height)?.catch(() => setActionError('Could not resize help.'));
    };
    const observer = new ResizeObserver(report);
    observer.observe(content.current); report();
    return () => observer.disconnect();
  }, []);
  const suggestion = state?.suggestion?.id === dismissedId ? null : state?.suggestion;
  const preview = suggestion?.source === 'preview';
  const app = suggestion?.app ?? 'facetime';
  const { name, icon: AppIcon, choices } = apps[app];
  return <section className={`call-help-card${app === 'safari' ? ' call-help-safari' : ''}`} aria-labelledby="call-help-title" aria-busy={pending}>
    <div className="call-help-content" ref={content}>
      <header className="call-help-header"><h1 id="call-help-title">{name} help</h1><button className="call-help-close" aria-label={`Close ${name} help`} onClick={() => void dismiss()}><X size={22} /></button></header>
      <div className="call-help-body">
        {!(app === 'safari' && (pending || actionError)) && <span className="call-help-chip"><AppIcon aria-hidden="true" />{suggestion ? preview ? 'Demo preview' : suggestion.source === 'detected' && app === 'facetime' ? 'FaceTime call detected' : 'Choose a guide' : name}</span>}
        {(!suggestion || preview || app !== 'safari') && <p>{suggestion ? preview ? 'Choose a guide for your open app.' : app === 'facetime' ? 'For FaceTime calls.' : 'Follow along in the app.' : error ? 'Could not load help.' : state ? 'No help right now.' : 'Checking…'}</p>}
        {suggestion && <div className={`call-help-choices${choices.length === 1 ? ' call-help-single-choice' : ''}`}>{choices.map(({ id, label, accessible, icon: Icon }) => <button key={id} className="call-help-choice" aria-label={accessible} data-call-lesson={id} disabled={pending} onClick={() => void act(() => window.helpOS!.chooseCallHelpLesson(id))}><Icon aria-hidden="true" /><span>{label}</span><ChevronRight className="call-help-chevron" aria-hidden="true" /></button>)}</div>}
        {pending && <p className="call-help-feedback" role="status">Opening…</p>}
        {actionError && <p className="call-help-feedback" role="alert">{actionError}</p>}
      </div>
      <footer className="call-help-footer"><button className="button secondary" onClick={() => void dismiss()}>Not now</button><button className="button quiet" aria-label={state?.enabled === false ? 'Automatic help is off' : 'Turn off automatic help'} disabled={pending || !state?.enabled} onClick={() => void act(() => apply(() => window.helpOS!.setCallHelpEnabled(false)))}>{state?.enabled === false ? 'Auto help off' : 'Stop auto help'}</button></footer>
    </div>
  </section>;
}
