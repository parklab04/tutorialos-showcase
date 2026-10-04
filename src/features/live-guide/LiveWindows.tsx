import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppWindow, BookOpen, Bookmark, BookmarkPlus, Camera, CameraOff, Check, Folder, History, LoaderCircle, Mic, MicOff, MousePointer2, Pause, PhoneOff, Play, RotateCcw, ShieldCheck, SquareStack, X, ZoomIn } from 'lucide-react';
import { lessons } from '../lessons/catalog';
import { useLiveState } from './useLiveState';
import { spotlightPadding } from '../../shared/ui/spotlight-layout';
import { PointerCompanion } from './PointerCompanion';
import { guidePointerMode } from './contracts';
import type { LessonId } from '../lessons/types';
import './live-guide.css';

const faceTimeControls: Array<{ id: LessonId; label: string; accessible: string; icon: typeof Mic }> = [
  { id: 'facetime-mic', label: 'Mic', accessible: 'Microphone guide', icon: Mic },
  { id: 'facetime-camera', label: 'Camera', accessible: 'Camera guide', icon: Camera },
  { id: 'facetime-end', label: 'End call', accessible: 'End call guide', icon: PhoneOff },
];
const actions: Record<string, { title: string; icon: typeof Mic }> = {
  'mic-off': { title: 'Click to mute', icon: MicOff },
  'mic-on': { title: 'Click to unmute', icon: Mic },
  'camera-off': { title: 'Turn camera off', icon: CameraOff },
  'camera-on': { title: 'Turn camera on', icon: Camera },
  'mic-toggle': { title: 'Click microphone', icon: Mic },
  'mic-toggle-again': { title: 'Click it again', icon: Mic },
  'camera-toggle': { title: 'Click camera', icon: Camera },
  'camera-toggle-again': { title: 'Click it again', icon: Camera },
  'end-call': { title: 'Click to leave', icon: PhoneOff },
  'open-view-menu': { title: 'Click View', icon: MousePointer2 },
  'zoom-in': { title: 'Click Zoom In', icon: ZoomIn },
  'show-reader': { title: 'Click Show Reader', icon: BookOpen },
  'open-bookmarks-menu': { title: 'Click Bookmarks', icon: Bookmark },
  'add-bookmark': { title: 'Click Add Bookmark', icon: BookmarkPlus },
  'save-bookmark': { title: 'Click Add', icon: Check },
  'open-history-menu': { title: 'Click History', icon: History },
  'reopen-closed-tab': { title: 'Reopen the tab', icon: RotateCcw },
  'open-downloads': { title: 'Click Downloads', icon: Folder },
};
type PermissionPhase = 'idle' | 'asking' | 'settings' | 'ready' | 'error';

export function LiveWindow({ overlay }: { overlay: boolean }) {
  const { state, error } = useLiveState();
  const [actionError, setActionError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [completing, setCompleting] = useState(false);
  const completeBusy = useRef(false);
  const switchBusy = useRef(false);
  const actionRevision = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const [permissionPhase, setPermissionPhase] = useState<PermissionPhase>('idle');
  const permissionBusy = useRef(false);
  useEffect(() => () => { actionRevision.current++; }, []);
  useEffect(() => { actionRevision.current++; switchBusy.current = false; completeBusy.current = false; setCompleting(false); setSwitching(false); setPermissionPhase('idle'); permissionBusy.current = false; setActionError(false); }, [state?.sessionId]);
  useEffect(() => {
    if (state?.status === 'guiding' || (state?.permission.accessibility && ['observing', 'waiting-app', 'waiting-control', 'complete'].includes(state.status))) setPermissionPhase('idle');
  }, [state?.status, state?.permission.accessibility, permissionPhase]);
  useEffect(() => {
    if (overlay || !window.helpOS || (permissionPhase === 'idle' && state?.status !== 'permission') || permissionPhase === 'asking') return;
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (!active || reading || permissionBusy.current) return;
      reading = true;
      const revision = actionRevision.current;
      try {
        // Returning from Mac settings reads consent only; it never requests it.
        const status = await window.helpOS!.getStatus();
        if (!active || revision !== actionRevision.current) return;
        if (status.accessibility) setPermissionPhase('ready');
        else if (permissionPhase === 'ready') setPermissionPhase('settings');
      } catch {
        // Keep the existing recovery action available after a background read fails.
      } finally { reading = false; }
    };
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [overlay, permissionPhase, state?.sessionId, state?.status, state?.permission.accessibility]);
  const [origin, setOrigin] = useState(() => ({ x: window.screenX, y: window.screenY }));
  const lesson = lessons.find(item => item.id === state?.lessonId);
  const goal = state?.completionMode === 'manual' ? state.goal : undefined;
  const faceTime = (goal?.app ?? lesson?.app) === 'facetime';
  const paused = state?.status === 'paused';
  const complete = state?.status === 'complete';

  useEffect(() => {
    if (overlay) return;
    let previous = 0;
    const report = () => {
      const scale = Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16));
      if (scale === previous) return;
      previous = scale;
      void window.helpOS?.reportCoachScale?.(scale)?.catch(() => setActionError(true));
    };
    const observer = new MutationObserver(report);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    report();
    return () => observer.disconnect();
  }, [overlay]);
  useLayoutEffect(() => {
    if (overlay || !content.current || !state?.coachLayoutId) return;
    let active = true;
    let previous = 0;
    const report = () => {
      if (!active || !content.current) return;
      // Measure intrinsic content, not the native viewport, so resizing cannot
      // turn a previously clipped flex body into the next requested height.
      const shell = getComputedStyle(content.current.parentElement!);
      const spacing = [shell.borderTopWidth, shell.borderBottomWidth, shell.marginTop, shell.marginBottom].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
      const height = Math.ceil(content.current.getBoundingClientRect().height + spacing);
      if (height === previous) return;
      previous = height;
      void window.helpOS?.reportCoachHeight?.(height, state.coachLayoutId)?.catch(() => { if (active) setActionError(true); });
    };
    const observer = new ResizeObserver(report);
    observer.observe(content.current);
    report();
    return () => { active = false; observer.disconnect(); };
  }, [overlay, state?.coachLayoutId]);
  useLayoutEffect(() => {
    if (!overlay || !state || !guidePointerMode(state) || state.overlayOrigin) return;
    let frame = 0;
    const measure = () => {
      const x = window.screenX; const y = window.screenY;
      setOrigin(previous => previous.x === x && previous.y === y ? previous : { x, y });
    };
    const track = () => { measure(); frame = window.requestAnimationFrame(track); };
    measure(); frame = window.requestAnimationFrame(track);
    window.addEventListener('resize', measure);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', measure); };
  }, [overlay, state?.status, !!state?.overlayOrigin]);
  const invoke = (operation: (() => Promise<unknown>) | undefined) => {
    setActionError(false);
    const revision = actionRevision.current;
    void operation?.().catch(() => { if (revision === actionRevision.current) setActionError(true); });
  };
  const closeHelp = () => {
    actionRevision.current++; switchBusy.current = false; completeBusy.current = false; permissionBusy.current = false; setCompleting(false); setSwitching(false);
    invoke(window.helpOS?.stopLive);
  };
  useEffect(() => {
    document.documentElement.classList.add('floating-document');
    document.body.classList.add(overlay ? 'overlay-body' : 'coach-body');
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeHelp(); } };
    window.addEventListener('keydown', key);
    return () => { document.documentElement.classList.remove('floating-document'); document.body.classList.remove('overlay-body', 'coach-body'); window.removeEventListener('keydown', key); };
  }, [overlay]);
  const completeGoal = async () => {
    if (!state?.canComplete || !goal || completeBusy.current) return;
    completeBusy.current = true; setCompleting(true); setActionError(false);
    const revision = actionRevision.current;
    try {
      if (!window.helpOS?.completeGoal) throw new Error('Completion unavailable');
      await window.helpOS.completeGoal();
    } catch { if (revision === actionRevision.current) setActionError(true); }
    finally { if (revision === actionRevision.current) { completeBusy.current = false; setCompleting(false); } }
  };
  const switchLesson = async (id: LessonId) => {
    if (switchBusy.current || (id === state?.lessonId && state?.status !== 'complete')) return;
    switchBusy.current = true; setSwitching(true); setActionError(false);
    const revision = ++actionRevision.current;
    try {
      if (!window.helpOS?.switchLiveLesson) throw new Error('Guide switching unavailable');
      await window.helpOS.switchLiveLesson(id);
    } catch { if (revision === actionRevision.current) setActionError(true); }
    finally { if (revision === actionRevision.current) { switchBusy.current = false; setSwitching(false); } }
  };
  const allowAccess = async () => {
    if (permissionBusy.current) return;
    permissionBusy.current = true; setPermissionPhase('asking'); setActionError(false);
    const revision = actionRevision.current;
    try {
      if (!window.helpOS) throw new Error('Mac access unavailable');
      const result = await window.helpOS.requestPermission('accessibility');
      if (revision !== actionRevision.current) return;
      setPermissionPhase(result.granted ? 'ready' : result.settingsOpened ? 'settings' : 'error');
    } catch { if (revision === actionRevision.current) setPermissionPhase('error'); }
    finally { if (revision === actionRevision.current) permissionBusy.current = false; }
  };

  const checkAccess = async () => {
    if (permissionBusy.current) return;
    permissionBusy.current = true; setPermissionPhase('asking'); setActionError(false);
    const revision = actionRevision.current;
    try {
      if (!window.helpOS) throw new Error('Mac access unavailable');
      const result = await window.helpOS.getStatus();
      if (revision === actionRevision.current) setPermissionPhase(result.accessibility ? 'ready' : 'settings');
    } catch { if (revision === actionRevision.current) setPermissionPhase('error'); }
    finally { if (revision === actionRevision.current) permissionBusy.current = false; }
  };

  if (overlay) {
    if (!state || error || !guidePointerMode(state)) return null;
    const actualOrigin = state.overlayOrigin ?? origin;
    const target = state.status === 'guiding' ? state.target : null;
    return <>
      {target && <div className="native-target" aria-hidden="true" style={{ left: target.x - actualOrigin.x - spotlightPadding, top: target.y - actualOrigin.y - spotlightPadding, width: target.width + spotlightPadding * 2, height: target.height + spotlightPadding * 2 }} />}
      <PointerCompanion state={state} origin={actualOrigin} />
    </>;
  }

  const action = actions[state?.currentAction ?? ''];
  let title = action?.title ?? 'Finding button';
  let Icon = action?.icon ?? LoaderCircle;
  let line = state?.status === 'guiding' ? faceTime ? 'Click the outlined button in FaceTime.' : 'Use the outlined button.' : '';
  const permissionSetup = permissionPhase !== 'idle' || state?.status === 'permission';
  let button: { label: string; run: () => void; disabled?: boolean } | null = null;
  if (actionError || error || state?.status === 'error') {
    title = 'Try again'; Icon = RotateCcw; line = '';
    button = { label: 'Retry', run: () => invoke(window.helpOS?.retryLive) };
  } else if (permissionSetup) {
    title = permissionPhase === 'asking' ? 'Checking access' : permissionPhase === 'ready' ? 'Access ready' : permissionPhase === 'settings' ? 'Turn on HelpOS' : permissionPhase === 'error' ? 'Try again' : 'Allow Accessibility';
    Icon = ShieldCheck; line = permissionPhase === 'settings' ? 'In Accessibility settings.' : permissionPhase === 'idle' ? 'So HelpOS can find buttons.' : '';
    if (permissionPhase === 'settings') button = { label: 'Check access', run: () => void checkAccess() };
    else if (permissionPhase === 'ready') button = { label: 'Continue guide', run: () => { setPermissionPhase('idle'); invoke(window.helpOS?.retryLive); } };
    else button = { label: permissionPhase === 'asking' ? 'Checking…' : 'Open Mac Settings', run: () => void allowAccess(), disabled: permissionPhase === 'asking' };
  } else if (complete) {
    title = 'Done'; Icon = Check; line = state.verification === 'self-confirmed' ? 'You confirmed it.' : state.verification === 'observed' ? 'Change confirmed.' : 'Guide finished.';
  } else if (paused) {
    title = 'Paused'; Icon = Pause; line = '';
  } else if (state?.canConfirm) {
    title = lesson?.confirmation?.title ?? 'Text larger?'; Icon = action?.icon ?? ZoomIn; line = '';
    button = { label: lesson?.confirmation?.label ?? 'Yes, it is larger', run: () => invoke(window.helpOS?.confirmLive) };
  } else if (state?.status === 'waiting-app') {
    title = faceTime ? 'Show your call' : lesson?.app === 'finder' ? 'Open Finder' : 'Open Safari'; Icon = AppWindow;
    line = faceTime ? 'Bring your FaceTime call into view. Checking automatically.' : '';
    if (lesson?.requiresAccessibility) line = 'Keep Safari in front. Checking automatically.';
    else if (!faceTime) button = { label: 'Check again', run: () => invoke(window.helpOS?.retryLive) };
  } else if (state?.status === 'waiting-control') {
    const covered = state.title.toLowerCase().includes('covered');
    const needsRoom = state.message === 'Make room for help.';
    const ambiguous = faceTime && state.title === 'HelpOS could not confirm the button state.';
    title = ambiguous ? 'Button state unclear' : needsRoom ? `Move ${faceTime ? 'FaceTime' : lesson?.app === 'safari' ? 'Safari' : 'Finder'}` : covered ? 'Move a window' : faceTime ? 'Reveal call buttons' : 'Find the button';
    Icon = ambiguous ? LoaderCircle : covered || needsRoom ? SquareStack : MousePointer2;
    line = ambiguous ? 'Keep the call controls visible.' : needsRoom ? 'Make room for help.' : covered ? 'Move the covering window.' : faceTime ? 'Keep your pointer over FaceTime.' : '';
    // The engine keeps observing. Asking for a coach click hides FaceTime's toolbar.
    if (faceTime) line += ' Checking automatically.';
    else if (lesson?.id === 'safari-zoom' && state.title === 'Zoom In is unavailable') {
      title = state.title; line = state.message; Icon = ZoomIn;
    }
    else if (lesson?.requiresAccessibility) {
      if (!needsRoom) {
        title = state.title === 'HelpOS could not find the button on this screen.' ? 'Find the button' : state.title;
        line = state.message === 'Open the app and the screen you need, then check again.' ? 'Keep Safari in front. Checking automatically.' : state.message;
      }
    } else button = { label: 'Check again', run: () => invoke(window.helpOS?.retryLive) };
  } else if (!state || state.status !== 'guiding' || switching) {
    title = 'Finding button'; Icon = LoaderCircle; line = '';
  }

  if (goal && !permissionSetup && !actionError && !error && state?.status !== 'error' && !paused) {
    title = state?.title || goal.label;
    line = state?.message || 'Waiting for the app.';
    Icon = goal.id === 'zoom-in' ? ZoomIn : goal.id === 'camera-off' ? CameraOff : goal.id === 'camera-on' ? Camera : goal.id === 'mute' ? MicOff : Mic;
    button = null;
  }

  // Only offer the keyboard route once this action's real target is observed.
  // Offering it on a prerequisite menu step could bypass completion evidence.
  const keyboardShortcuts = state?.status === 'guiding' && state.target && !state.canConfirm && !permissionSetup && !actionError && !error && !switching && !completing
    ? lesson?.steps.find(step => step.action === state.currentAction)?.keyboardShortcuts
    : undefined;

  const recovery = permissionSetup || actionError || error || state?.status === 'error';
  if (!recovery && state?.status === 'guiding' && state.target && !state.canConfirm && !switching) {
    title = action?.title ?? 'Click the outlined button';
    line = '';
  } else if (!recovery && state?.status === 'guiding' && !state.target && !state.canConfirm) {
    title = 'Finding button'; line = '';
  } else if (!recovery) {
    line = line.replace(/\s*Checking automatically\./g, '').trim();
  }
  const canComplete = !!goal && !!state?.canComplete && !recovery && !paused;
  const resultQuestion = goal ? { mute: 'Microphone muted?', unmute: 'Microphone on?', 'camera-off': 'Camera off?', 'camera-on': 'Camera on?', 'zoom-in': 'Page large enough?' }[goal.id] : '';
  const tabs = faceTime && !goal ? <div className="live-control-tabs" role="tablist" aria-label="FaceTime guides">{faceTimeControls.map(({ id, label, accessible, icon: TabIcon }, index) => <button key={id} id={`live-tab-${id}`} className="live-control-tab" role="tab" aria-label={accessible} aria-selected={state?.lessonId === id} aria-controls="live-control-panel" tabIndex={state?.lessonId === id ? 0 : -1} disabled={switching} onClick={() => void switchLesson(id)} onKeyDown={event => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null;
    if (next === null) return;
    event.preventDefault(); document.getElementById(`live-tab-${faceTimeControls[next].id}`)?.focus();
    void switchLesson(faceTimeControls[next].id);
  }}><TabIcon aria-hidden="true" /><span>{label}</span></button>)}</div> : null;

  return <section className={`native-coach icon-coach${goal ? ' goal-coach' : ''}${recovery ? '' : ' companion-coach'}`} data-presentation={recovery ? 'recovery' : 'companion'} aria-label="Live click guide" aria-busy={switching || completing || permissionPhase === 'asking'}>
    <div className="live-coach-content" ref={content}>
      {recovery && <header className="native-coach-header">
        <span className="live-guide-label">{faceTime ? 'FaceTime' : lesson?.app === 'safari' ? 'Safari' : lesson?.app === 'finder' ? 'Finder' : 'HelpOS'} · Click guide</span>
      </header>}
      <div className="native-coach-body" id={tabs && !recovery ? 'live-control-panel' : undefined} role={tabs && !recovery ? 'tabpanel' : undefined} aria-labelledby={tabs && !recovery ? `live-tab-${state?.lessonId}` : undefined}>
        <div className="live-action" aria-live="polite" aria-atomic="true">
          {recovery && <span className="live-action-icon" aria-hidden="true"><Icon /></span>}
          <h2>{title}</h2>
          {line && <p>{line}</p>}
        </div>
        {keyboardShortcuts?.length ? <aside className="live-shortcut-note" aria-label="Keyboard alternative">
          {keyboardShortcuts.map(shortcut => <div className="live-shortcut-row" key={shortcut.label}>
            <span>{keyboardShortcuts.length > 1 ? shortcut.label : 'Or press'}</span>
            <span className="live-shortcut-keys" role="group" aria-label={`${shortcut.label}: ${shortcut.keys.map(key => key === '+' ? 'Plus' : key === '−' ? 'Minus' : key).join(' and ')}`}>
              {shortcut.keys.map(key => <kbd key={key}>{key === 'Command' ? '⌘ Command' : key}</kbd>)}
            </span>
          </div>)}
        </aside> : null}
        {button && <button className="button primary live-recovery-button" disabled={button.disabled} onClick={button.run}>{button.label}</button>}
        {permissionPhase === 'settings' && <button className="button quiet live-find-app" onClick={() => invoke(window.helpOS?.showAppInFinder)}>Find HelpOS</button>}
      </div>
      <footer className="native-coach-footer">
        {canComplete && <p className="goal-result-question" id="goal-result-question">{resultQuestion}</p>}
        {canComplete && <button className="button primary goal-complete" title="Confirm that you completed this task" aria-describedby="goal-result-question" disabled={completing} onClick={() => void completeGoal()}><Check aria-hidden="true" />{completing ? 'Closing…' : 'Complete'}</button>}
        {!permissionSetup && <button className="button secondary" disabled={!state || complete} onClick={() => { invoke(paused ? window.helpOS?.resumeLive : window.helpOS?.pauseLive); }}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{paused ? 'Resume' : 'Pause'}</button>}
        <button className="button quiet" onClick={closeHelp} aria-label="Close help"><X aria-hidden="true" />Close help</button>
      </footer>
      {tabs && !recovery && <details className="companion-guides"><summary>Guides</summary>{tabs}</details>}
    </div>
  </section>;
}
