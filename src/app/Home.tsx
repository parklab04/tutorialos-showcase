import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ChevronRight, CircleHelp, Mic, MicOff, MousePointer2, Settings2, ShieldCheck, Type, X, ZoomIn } from 'lucide-react';
import { appNames, lessons } from '../features/lessons/catalog';
import { useLiveState } from '../features/live-guide/useLiveState';
import { CallHelpSettings, useCallHelpSettings } from '../features/call-help/CallHelpSettings';
import { Settings } from './Settings';
import type { Lesson } from '../features/lessons/types';
import type { VoiceGoalId } from '../features/voice-guide/contracts';
import type { AppStatus } from '../shared/bridge';

const browserStatus: AppStatus = { desktop: false, platform: 'browser', accessibility: false, screenCapture: false, aiConfigured: false, version: '' };
const goals: Array<{ id: VoiceGoalId; title: string; app: string; icon: typeof Mic }> = [
  { id: 'mute', title: 'Mute microphone', app: 'FaceTime', icon: MicOff },
  { id: 'unmute', title: 'Unmute microphone', app: 'FaceTime', icon: Mic },
  { id: 'camera-off', title: 'Turn camera off', app: 'FaceTime', icon: CameraOff },
  { id: 'camera-on', title: 'Turn camera on', app: 'FaceTime', icon: Camera },
  { id: 'zoom-in', title: 'Make text larger', app: 'Safari', icon: ZoomIn },
];
function HelpDialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="help-dialog" aria-labelledby="help-title" onCancel={close}>
    <div className="modal-header"><h2 id="help-title">You make the click</h2><button className="icon-button" aria-label="Close help" onClick={close}><X size={22} /></button></div>
    <div className="modal-body"><div className="help-step"><span>1</span><p>Press Control + Option + Space. Say what you need, then check the command.</p></div><div className="help-step"><span>2</span><p>Choose Show me. Click the outlined button in your app.</p></div><div className="help-step"><span>3</span><p>Choose Complete when you are finished. Press the shortcut for your next command.</p></div></div>
    <div className="modal-footer"><button className="button primary" onClick={close}>Got it</button></div>
  </dialog>;
}
export function Home({ scale, setScale }: { scale: number; setScale: (scale: number) => void }) {
  const [status, setStatus] = useState<AppStatus>(browserStatus);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const { state: liveState, setState: setLiveState } = useLiveState();
  const automaticHelp = useCallHelpSettings();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (!window.helpOS) return;
    try { const value = await window.helpOS.getStatus(); if (mounted.current) setStatus(value); }
    catch { if (mounted.current) setError('Could not check Mac access. Open Settings to try again.'); }
  }, []);
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [refresh]);
  const run = async (id: string, operation: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true; setStarting(id); setError('');
    try { await operation(); }
    catch { if (mounted.current) setError('Could not open the guide. Please try again.'); }
    finally { busy.current = false; if (mounted.current) setStarting(null); }
  };
  const startGoal = (id: VoiceGoalId) => run(id, async () => { if (!window.helpOS?.startGoal) throw new Error('Desktop required'); setLiveState(await window.helpOS.startGoal(id)); });
  const startLesson = (lesson: Lesson) => run(lesson.id, async () => { if (!window.helpOS) throw new Error('Desktop required'); setLiveState(await window.helpOS.startLive(lesson.id)); });
  const desktop = status.desktop && !!window.helpOS;
  return <div className="app-shell voice-home">
    <header className="app-header"><div className="brand"><span className="brand-mark"><MousePointer2 size={23} /></span><strong>HelpOS</strong><span>One click at a time</span></div><div className="header-actions"><button className="button quiet" onClick={() => setScale(scale === 1 ? 1.25 : 1)} aria-label={scale === 1 ? 'Make guide text larger' : 'Reset guide text size'}><Type size={21} /><span>{scale === 1 ? 'Larger text' : 'Default size'}</span></button><button className="button quiet" onClick={() => setHelp(true)}><CircleHelp size={21} />Help</button><button className="icon-button" onClick={() => setSettings(true)} aria-label="Settings"><Settings2 size={22} /></button></div></header>
    <main className="home-page">
      {!settings && <CallHelpSettings desktop={desktop} model={automaticHelp} variant="home" />}
      <section className="voice-home-hero" aria-labelledby="voice-home-title"><div><p className="eyebrow"><Mic size={19} />Voice click guide</p><h1 id="voice-home-title">What would you like to do?</h1><p>Say it. Click the outlined button. Choose Complete.</p><div className="voice-home-launch"><button className="button primary" disabled={!desktop || !!starting} onClick={() => void run('voice', async () => { if (!window.helpOS?.showVoice) throw new Error('Desktop required'); await window.helpOS.showVoice(); })}><Mic size={23} />{starting === 'voice' ? 'Opening…' : 'Open voice guide'}</button><span>or press <kbd>Control + Option + Space</kbd></span></div><p className="voice-home-example">Try “mute my microphone” or “make text larger.”</p></div><span className="voice-home-symbol" aria-hidden="true"><MousePointer2 /></span></section>
      {!desktop && <p className="notice" role="status">Open the installed Mac app to use live guidance.</p>}
      {error && <div className="notice" role="alert"><CircleHelp size={20} /><span>{error}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setError('')}><X size={18} /></button></div>}
      {liveState && liveState.status !== 'idle' && <section className="live-summary" aria-live="polite"><div><strong>{liveState.goal?.label ?? liveState.title ?? 'Guide open'}</strong><span>Your guide is open beside the app.</span></div><button className="button secondary" onClick={() => void run('close', async () => { await window.helpOS?.stopLive(); })}>Close help</button></section>}
      <section className="voice-goals" aria-labelledby="voice-goals-title"><h2 id="voice-goals-title">Or choose a command</h2><div className="voice-goal-grid">{goals.map(({ id, title, app, icon: Icon }) => <button key={id} className="voice-goal-card" disabled={!desktop || !!starting} onClick={() => void startGoal(id)}><Icon aria-hidden="true" /><span><strong>{starting === id ? 'Opening…' : title}</strong><span>{app}</span></span><ChevronRight size={19} aria-hidden="true" /></button>)}</div><p className="voice-home-note">FaceTime commands guide you during a call. You stay in control.</p></section>
      <details className="voice-more-guides"><summary>More step-by-step guides</summary><div className="voice-legacy-grid">{lessons.map(lesson => <button key={lesson.id} className="lesson-row" disabled={!desktop || !!starting} onClick={() => void startLesson(lesson)}><div><strong>{lesson.title}</strong><span>{appNames[lesson.app]}</span></div><ChevronRight size={20} /></button>)}</div></details>
      <p className="home-footnote"><ShieldCheck size={18} />HelpOS shows where to click. You make the changes.</p>
    </main>
    {settings && <Settings status={status} scale={scale} setScale={setScale} refresh={refresh} automaticHelp={automaticHelp} onClose={() => setSettings(false)} />}
    {help && <HelpDialog close={() => setHelp(false)} />}
  </div>;
}
