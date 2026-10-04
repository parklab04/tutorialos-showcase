import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Mic, Square, X } from 'lucide-react';
import { initialVoiceState, type VoiceState } from './contracts';
import './voice-guide.css';

export function VoicePanel() {
  const [state, setState] = useState<VoiceState>(initialVoiceState);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const busy = useRef(false);
  const available = !!window.helpOS?.getVoiceState;
  useEffect(() => {
    mounted.current = true;
    const bridge = window.helpOS;
    if (!bridge?.getVoiceState || !bridge.onVoiceState) return () => { mounted.current = false; };
    let received = false;
    const off = bridge.onVoiceState(value => { received = true; if (mounted.current) { setState(value); setError(''); } });
    void bridge.getVoiceState().then(value => { if (mounted.current && !received) setState(value); }).catch(() => { if (mounted.current && !received) setError('Could not connect. Try Record or type a command.'); });
    return () => { mounted.current = false; revision.current++; off(); };
  }, []);
  useEffect(() => { setDraft(state.transcript); }, [state.transcript, state.phase]);
  const run = useCallback(async (name: string, operation: () => Promise<unknown>) => {
    if (busy.current && name !== 'stop') return;
    const current = ++revision.current;
    busy.current = true; setPending(name); setError('');
    try { await operation(); }
    catch { if (mounted.current && current === revision.current) setError('That did not work. Try again or type a command.'); }
    finally { if (mounted.current && current === revision.current) { busy.current = false; setPending(null); } }
  }, []);
  const cancel = useCallback(async () => {
    const current = ++revision.current;
    busy.current = false; setPending(null); setError('');
    try { await window.helpOS?.cancelVoice(); }
    catch { if (mounted.current && current === revision.current) setError('Could not cancel. Try again.'); }
  }, []);
  useEffect(() => {
    document.documentElement.classList.add('voice-document');
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void cancel(); } };
    window.addEventListener('keydown', key);
    return () => { document.documentElement.classList.remove('voice-document'); window.removeEventListener('keydown', key); };
  }, [cancel]);
  useLayoutEffect(() => {
    if (!content.current) return;
    let previous = 0;
    const report = () => {
      if (!content.current) return;
      const height = Math.ceil(content.current.getBoundingClientRect().height + 14);
      if (height === previous) return;
      previous = height;
      void window.helpOS?.reportVoiceHeight?.(height)?.catch(() => { if (mounted.current) setError('Could not resize the guide.'); });
    };
    const observer = new ResizeObserver(report); observer.observe(content.current); report();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let previous = 0;
    const report = () => {
      const scale = Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16));
      if (scale === previous) return;
      previous = scale;
      void window.helpOS?.reportVoiceScale?.(scale)?.catch(() => { if (mounted.current) setError('Could not resize the guide.'); });
    };
    const observer = new MutationObserver(report);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    report();
    return () => observer.disconnect();
  }, []);
  const capturing = state.phase === 'requesting' || state.phase === 'listening';
  const processing = state.phase === 'processing';
  const reviewed = state.phase === 'review' && !!state.goal && draft.trim() === state.transcript.trim();
  const status = state.phase === 'requesting' ? 'Allow voice access when your Mac asks.' : state.phase === 'listening' ? 'Listening… speak your command.' : processing ? 'Checking your command…' : reviewed ? state.goal!.label : state.phase === 'error' ? state.message || 'Try again or type a command.' : 'Say “mute my microphone.”';
  return <section className="voice-panel" aria-labelledby="voice-title" aria-busy={!!pending}>
    <div className="voice-panel-content" ref={content}>
      <header className="voice-panel-header"><h1 id="voice-title">Voice guide</h1><span>English · On-device speech</span></header>
      <div className="voice-panel-body">
        <p className={`voice-status${capturing ? ' is-listening' : ''}`} role={state.phase === 'error' ? 'alert' : 'status'} aria-live="polite">{available ? status : 'Open the Mac app to use voice guidance.'}</p>
        <div className="voice-record-controls" role="group" aria-label="Voice recording">
          <button className="button primary" disabled={!available || !!pending || capturing || processing} onClick={() => { setDraft(''); void run('record', () => window.helpOS!.startVoice()); }}><Mic aria-hidden="true" />Record</button>
          <button className="button secondary" disabled={!available || !capturing || pending === 'stop'} onClick={() => void run('stop', () => window.helpOS!.stopVoice())}><Square aria-hidden="true" />Stop</button>
          <button className="button quiet" onClick={() => void cancel()}><X aria-hidden="true" />Cancel</button>
        </div>
        <form className="voice-command-form" onSubmit={event => { event.preventDefault(); if (draft.trim() && !capturing && !processing) void run('review', () => window.helpOS!.submitVoiceText(draft.trim())); }}>
          <label htmlFor="voice-command">Or type a command</label>
          <input id="voice-command" type="text" value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} disabled={!available || capturing || processing || !!pending} placeholder="Make text larger" autoComplete="off" spellCheck={false} />
          {!reviewed && <button className="button secondary" type="submit" disabled={!available || !draft.trim() || capturing || processing || !!pending}>{pending === 'review' ? 'Checking…' : 'Review command'}</button>}
        </form>
        {reviewed && <div className="voice-reviewed"><p>Click the outlined button yourself.</p><button className="button primary" disabled={!!pending} onClick={() => void run('show', () => window.helpOS!.useVoiceGoal())}>Show me<ArrowRight aria-hidden="true" /></button></div>}
        {state.phase === 'review' && !reviewed && <p className="voice-hint">Review your edited command first.</p>}
        {error && <p className="voice-error" role="alert">{error}</p>}
      </div>
      <footer className="voice-panel-footer"><kbd>Control + Option + Space</kbd><span>{state.shortcutAvailable ? 'Press to start or stop recording.' : 'Use Record if the shortcut is unavailable.'}</span></footer>
    </div>
  </section>;
}
