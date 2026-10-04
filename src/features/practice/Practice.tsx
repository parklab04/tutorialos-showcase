import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, FileText, Folder, House, Mic, MicOff, Pause, PhoneOff, Play, RotateCcw, Search, ShieldCheck, Sidebar, Video, VideoOff, X } from 'lucide-react';
import { copy } from '../../shared/copy';
import { appNames } from '../lessons/catalog';
import { advanceSession, createSession, requestHint } from './session';
import { SafariPractice, initialSafariState } from './SafariPractice';
import { Spotlight } from '../../shared/ui/Spotlight';
import { placeCoach, type CoachPlacement } from '../../shared/ui/spotlight-layout';
import type { Lesson } from '../lessons/types';
import type { Rect } from '../../shared/geometry';

interface Props { lesson: Lesson; onExit: () => void }

function useTutorialPlacement(target: string, enabled: boolean, revision: string, coach: React.RefObject<HTMLElement | null>, preferAbove: boolean, fitContents: boolean) {
  const [layout, setLayout] = useState<{ target: Rect | null; coach: CoachPlacement | null }>({ target: null, coach: null });
  useLayoutEffect(() => {
    if (!enabled) { setLayout({ target: null, coach: null }); return; }
    const element = document.querySelector<HTMLElement>(`[data-guide-target="${target}"]`);
    if (!element) { setLayout({ target: null, coach: null }); return; }
    const measure = () => {
      const box = element.getBoundingClientRect();
      const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      const visible = box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
      const contentHeight = fitContents && coach.current
        ? ['.spotlight-context', '.practice-coach-content', '.practice-coach-footer'].reduce((height, selector) => height + (coach.current?.querySelector<HTMLElement>(selector)?.scrollHeight || 0), 2)
        : coach.current?.scrollHeight || 440;
      const height = Math.min(contentHeight, 440);
      const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
      const placement = visible ? placeCoach(rect, { width: window.innerWidth, height: window.innerHeight }, height, preferAbove, 360 * scale) : null;
      const next = { target: visible ? rect : null, coach: placement };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const initial = element.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
    if (scale > 1 || initial.top < 16 || initial.bottom > window.innerHeight - 16) {
      // Menu controls belong near the top, leaving room for guidance below them.
      // Call and sidebar controls leave that reading space above instead.
      const menuTarget = ['view-menu', 'zoom-in', 'show-reader', 'bookmarks-menu', 'add-bookmark', 'history-menu', 'reopen-closed-tab'].includes(target);
      element.scrollIntoView({ block: scale > 1 ? menuTarget ? 'start' : 'end' : 'center', behavior: 'instant' });
      if (scale > 1) window.scrollBy(0, menuTarget ? -16 : 16);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (coach.current) observer.observe(coach.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [target, enabled, revision, coach, preferAbove, fitContents]);
  return layout;
}

export function Practice({ lesson, onExit }: Props) {
  const [session, setSession] = useState(() => createSession(lesson.id));
  const [paused, setPaused] = useState(false);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [ended, setEnded] = useState(false);
  const [safari, setSafari] = useState(() => initialSafariState(lesson.id));
  const [sceneRevision, setSceneRevision] = useState(0);
  const [folder, setFolder] = useState('recent');
  const [notice, setNotice] = useState('');
  const [showPrevious, setShowPrevious] = useState(false);
  const completeRef = useRef<HTMLHeadingElement>(null);
  const coachRef = useRef<HTMLElement>(null);
  const step = lesson.steps[Math.min(session.stepIndex, lesson.steps.length - 1)];

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); onExit(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onExit]);
  useEffect(() => { if (session.complete) completeRef.current?.focus(); }, [session.complete]);

  const act = (action: string) => {
    if (paused || session.complete) return;
    const next = advanceSession(session, action);
    if (next === session) setNotice(session.hints ? copy.practice.wrongControl : `Try another control, or choose “${copy.result.showHint}” for a hint.`);
    else { setNotice(''); setShowPrevious(false); setSession(next); }
  };
  const restart = (hints = true) => {
    setSession(createSession(lesson.id, hints)); setPaused(false); setMic(true); setCamera(true);
    setEnded(false); setSafari(initialSafariState(lesson.id)); setSceneRevision(value => value + 1); setFolder('recent'); setNotice(''); setShowPrevious(false);
  };
  const safariRecoveryMessage = step.action === 'zoom-in' || step.action === 'show-reader'
    ? safari.menu !== 'view' ? `Open View again to find ${step.action === 'zoom-in' ? 'Zoom In' : 'Show Reader'}.` : ''
    : step.action === 'add-bookmark' ? safari.menu !== 'bookmarks' ? 'Open Bookmarks again to find Add Bookmark.' : ''
    : step.action === 'save-bookmark' ? !safari.bookmarkDialog ? 'Open Bookmarks, then choose Add Bookmark again.' : ''
    : step.action === 'reopen-closed-tab' ? safari.menu !== 'history' ? 'Open History again to restore the tab.' : '' : '';
  const targetAvailable = !ended && !safariRecoveryMessage;
  const toggleMismatch = (step.action === 'mic-off' && !mic) || (step.action === 'mic-on' && mic) || (step.action === 'camera-off' && !camera) || (step.action === 'camera-on' && camera);
  const safariMismatch = (step.action === 'show-reader' && safari.reader) || (step.action === 'save-bookmark' && safari.bookmarked) || (step.action === 'reopen-closed-tab' && safari.tabOpen);
  const recovery = !session.complete && (ended || toggleMismatch || safariMismatch);
  const reveal = () => { setSession(requestHint(session)); setNotice(''); };
  const layout = useTutorialPlacement(step.target, session.hints && !session.complete, `${session.stepIndex}-${JSON.stringify(safari)}-${sceneRevision}-${mic}-${camera}-${ended}-${folder}`, coachRef, lesson.app === 'facetime', lesson.app === 'safari');
  const spotlightVisible = !paused && !session.complete && session.hints && !recovery && targetAvailable && !!layout.target && !!layout.coach;
  const floating = session.hints && !session.complete && layout.coach;


  return <main className="practice-page">
    <div className="lesson-topline"><button className="button quiet" onClick={onExit}><ArrowLeft size={20} />{copy.lesson.back}</button><span>{appNames[lesson.app]}</span></div>
    <div className="context-banner"><ShieldCheck size={20} /><span>{copy.modes.practice.badge}</span></div>
    <div className="practice-heading"><h1>{lesson.title}</h1></div>
    <div className="practice-layout">
      <section className={`scene scene-${lesson.app}`} aria-label={`${appNames[lesson.app]} Practice scene`}>
        <div className="scene-titlebar"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>{copy.practice[lesson.app].title}</span><span className="scene-mode">Practice</span></div>
        {lesson.app === 'facetime' && <div className="facetime-scene">
          <div className="call-illustration">
            {ended ? <><span className="call-avatar ended-avatar"><PhoneOff size={38} /></span><h2>{copy.practice.facetime.ended}</h2><p>{copy.practice.facetime.endedDescription}</p></> : <>
              <span className={`call-avatar ${camera ? '' : 'camera-hidden'}`}>{camera ? <Video size={42} /> : <VideoOff size={42} />}</span>
              <h2>{copy.practice.facetime.participant}</h2><p>{copy.practice.facetime.disconnected}</p>
              <div className="call-status"><span>{mic ? <Mic size={16} /> : <MicOff size={16} />}{mic ? copy.practice.facetime.micOn : copy.practice.facetime.micOff}</span><span>{camera ? <Video size={16} /> : <VideoOff size={16} />}{camera ? copy.practice.facetime.cameraOn : copy.practice.facetime.cameraOff}</span></div>
            </>}
          </div>
          {!ended && <div className="call-controls">
            <button data-guide-target="microphone" className={`call-control ${mic ? '' : 'toggled'}`} aria-pressed={!mic} onClick={() => { setMic(!mic); act(mic ? 'mic-off' : 'mic-on'); }}>{mic ? <Mic size={26} /> : <MicOff size={26} />}<span>{mic ? copy.practice.facetime.mute : copy.practice.facetime.unmute}</span></button>
            <button data-guide-target="camera" className={`call-control ${camera ? '' : 'toggled'}`} aria-pressed={!camera} onClick={() => { setCamera(!camera); act(camera ? 'camera-off' : 'camera-on'); }}>{camera ? <Video size={26} /> : <VideoOff size={26} />}<span>{camera ? copy.practice.facetime.turnCameraOff : copy.practice.facetime.turnCameraOn}</span></button>
            <button data-guide-target="end-call" className="call-control end-call" onClick={() => { setEnded(true); act('end-call'); }}><PhoneOff size={26} /><span>{copy.practice.facetime.end}</span></button>
          </div>}
        </div>}
        {lesson.app === 'safari' && <SafariPractice key={sceneRevision} lessonId={lesson.id} onAction={act} onSceneChange={setSafari} />}
        {lesson.app === 'finder' && <div className="finder-scene">
          <nav className="finder-sidebar" aria-label="Finder practice locations"><div>{copy.practice.finder.sidebar}</div>{[{ id: 'recent', label: copy.practice.finder.recent, icon: <RotateCcw size={20} /> }, { id: 'desktop', label: copy.practice.finder.desktop, icon: <House size={20} /> }, { id: 'documents', label: copy.practice.finder.documents, icon: <FileText size={20} /> }, { id: 'downloads', label: copy.practice.finder.downloads, icon: <ArrowDownToLine size={20} /> }].map(item => <button key={item.id} data-guide-target={item.id === 'downloads' ? 'downloads' : undefined} aria-current={folder === item.id ? 'location' : undefined} className={folder === item.id ? 'selected' : ''} onClick={() => { setFolder(item.id); act(item.id === 'downloads' ? 'open-downloads' : item.id); }}>{item.icon}<span>{item.label}</span></button>)}</nav>
          <div className="finder-content"><div className="finder-toolbar"><Sidebar size={20} /><strong>{folder === 'downloads' ? copy.practice.finder.downloads : folder === 'documents' ? copy.practice.finder.documents : folder === 'desktop' ? copy.practice.finder.desktop : copy.practice.finder.recent}</strong><Search size={20} /></div><div className="finder-files">{folder === 'downloads' ? <><span className="sample-file-icon"><FileText size={44} /></span><strong>{copy.practice.finder.sampleName}</strong><p>{copy.practice.finder.sampleDescription}</p></> : <><Folder size={52} strokeWidth={1.4} /><p>Choose a location on the left.</p></>}</div><div className="scene-statusbar">{folder === 'downloads' ? '1 sample file' : 'Practice folder'}</div></div>
        </div>}
      </section>
      <aside ref={coachRef} className={`practice-coach coach-card ${lesson.app === 'safari' ? 'practice-safari-coach' : ''} ${floating ? 'spotlight-coach' : ''}`} aria-label="Click guide" style={floating ? { left: floating.x, top: floating.y, width: floating.width, maxHeight: floating.height } : undefined}>
        {floating && <><span className={`coach-pointer pointer-${floating.side}`} aria-hidden="true" style={floating.side === 'left' || floating.side === 'right' ? { top: floating.arrow } : { left: floating.arrow }} /><div className="spotlight-context"><ShieldCheck size={18} />Practice scene</div></>}
        {session.complete ? <><div className="practice-coach-content"><div className="completion-mark"><Check size={27} /></div><h2 ref={completeRef} tabIndex={-1}>{copy.result.title}</h2><p>{lesson.outcome}</p><div className="evidence"><Check size={17} />{copy.result.practiceVerified}</div>{lesson.id === 'safari-zoom' && <p className="comfort-note">To make the text larger again, choose View → Zoom In.</p>}</div><div className="practice-coach-footer"><div className="coach-actions"><button className="button primary" onClick={() => restart(false)}>{copy.result.independent}<ArrowRight size={19} /></button><button className="button secondary" onClick={() => restart(true)}><RotateCcw size={18} />{copy.result.repeat}</button><button className="button quiet" onClick={onExit}>{copy.result.chooseAnother}</button></div></div></> : <>
          <div className="practice-coach-content">
          <div className="step-meta"><span>{paused ? 'Paused' : session.hints ? 'Click guide' : 'Without hints'}</span><span>Step {session.stepIndex + 1} of {lesson.steps.length}</span></div>
          <div className="step-track" aria-hidden="true">{lesson.steps.map((item, index) => <i key={item.id} className={index <= session.stepIndex ? 'reached' : ''} />)}</div>
          <div className="instruction-content" aria-live="polite" aria-atomic="true">
            <h2>{paused ? copy.guide.paused : recovery ? 'Reset the practice scene.' : session.hints ? step.instruction : 'Find the control yourself.'}</h2>
            {(lesson.app !== 'safari' || paused || recovery || !session.hints) && <p>{paused ? 'When you resume, check any controls you changed while paused.' : recovery ? 'Restart practice to return to the beginning.' : session.hints ? step.why : lesson.description}</p>}
            {!paused && !recovery && session.hints && !targetAvailable && <div className="notice">{safariRecoveryMessage}</div>}
            {notice && !recovery && <div className="notice">{notice}</div>}
          </div>
          </div>
          <div className="practice-coach-footer">
          <div className="coach-actions">
            {paused ? <button className="button primary" onClick={() => setPaused(false)}><Play size={18} />{copy.guide.resume}</button> : recovery ? <button className="button primary" onClick={() => restart(session.hints)}><RotateCcw size={18} />{copy.practice.restart}</button> : !session.hints ? <button className="button primary" onClick={reveal}>{copy.result.showHint}</button> : null}
            <div className="coach-control-row">
              {!paused && <button className="button secondary" aria-label={copy.guide.pause} onClick={() => { setPaused(true); setNotice(''); }}><Pause size={18} />{copy.guide.pause}</button>}
              <button className="button quiet" onClick={onExit}><X size={18} />{copy.guide.stop}</button>
            </div>
            {session.stepIndex > 0 && !paused && !floating && <button className="button quiet" onClick={() => setShowPrevious(!showPrevious)}>{showPrevious ? 'Hide previous step' : 'Review previous step'}</button>}
            {showPrevious && <p className="previous-instruction">{lesson.steps[session.stepIndex - 1]?.instruction}</p>}
          </div>
          <p className="coach-footnote">{lesson.app === 'facetime' ? <>Only the guide closes.<br />Use FaceTime to end a call.</> : <>Only the guide closes.<br />Your app stays open.</>}</p>
          </div>
        </>}
      </aside>
    </div>
    <div className="practice-bottom"><span>{copy.confidence.description}</span><button className="button quiet" onClick={() => restart(session.hints)}><RotateCcw size={18} />{copy.practice.restart}</button></div>
    {spotlightVisible && layout.target && <Spotlight target={layout.target} />}
  </main>;
}
