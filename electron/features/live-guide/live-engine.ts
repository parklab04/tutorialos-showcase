import { randomUUID } from 'node:crypto';
import { lessons, appNames } from '../../../src/features/lessons/catalog';
import { copy } from '../../../src/shared/copy';
import type { Lesson, LessonId } from '../../../src/features/lessons/types';
import type { LiveState, Observation, ObservedElement } from '../../../src/features/live-guide/contracts';
import type { Rect } from '../../../src/shared/geometry';
import type { VoiceGoal } from '../../../src/features/voice-guide/contracts';

export const bundleIds = { facetime: 'com.apple.FaceTime', safari: 'com.apple.Safari', finder: 'com.apple.finder' } as const;
export const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKC').replace(/[.…]/g, '').replace(/\s+/g, ' ').trim();
const faceTimeControlRoles = ['AXButton', 'AXCheckBox', 'AXToggleButton'];
const safariMenuActions = ['open-view-menu', 'open-bookmarks-menu', 'open-history-menu'];
const targetMaxAgeMs = 1500;
export function validRect(rect: Rect | null | undefined): rect is Rect {
  return !!rect && Object.values(rect).every(Number.isFinite) && Math.abs(rect.x) < 40000 && Math.abs(rect.y) < 40000 && rect.width >= 3 && rect.height >= 3 && rect.width < 12000 && rect.height < 12000;
}
export function matches(element: ObservedElement, aliases: readonly string[]): boolean {
  return aliases.some(alias => normalize(alias) === normalize(element.label));
}
export function findTarget(observation: Observation, aliases: readonly string[]): ObservedElement | null {
  const candidates = observation.elements.filter(element => element.enabled && validRect(element.rect) && element.rect.width <= 1600 && element.rect.height <= 500 && matches(element, aliases) && !['AXWindow', 'OCRWindowTitle'].includes(element.role));
  const distinct = candidates.filter((element, index) => candidates.findIndex(other => Math.abs(element.rect.x - other.rect.x) < 2 && Math.abs(element.rect.y - other.rect.y) < 2 && Math.abs(element.rect.width - other.rect.width) < 3 && Math.abs(element.rect.height - other.rect.height) < 3) === index);
  return distinct.length === 1 ? distinct[0] : null;
}
function controlsForStep(observation: Observation, lesson: Lesson, stepIndex: number): ObservedElement[] {
  const insideWindow = (element: ObservedElement) => !!observation.window && element.rect.x >= observation.window.x - 2 && element.rect.y >= observation.window.y - 2 && element.rect.x + element.rect.width <= observation.window.x + observation.window.width + 2 && element.rect.y + element.rect.height <= observation.window.y + observation.window.height + 2;
  const action = lesson.steps[stepIndex].action;
  return observation.elements.filter(element => {
    if (lesson.app === 'facetime') return insideWindow(element) && faceTimeControlRoles.includes(element.role);
    if (lesson.app === 'finder') return insideWindow(element) && element.rect.x < observation.window!.x + Math.min(320, observation.window!.width * 0.4);
    if (action === 'save-bookmark') return observation.trusted && observation.source === 'accessibility' && insideWindow(element) && element.role === 'AXButton' && element.scope === 'bookmark-sheet';
    const menuAnchor = safariMenuActions.includes(action);
    // OCR text alone cannot tell an enabled command from greyed-out text.
    if (!menuAnchor && (!observation.trusted || observation.source !== 'accessibility')) return false;
    const roles = menuAnchor ? ['AXMenuBarItem'] : ['AXMenuItem'];
    if (menuAnchor && !lesson.requiresAccessibility) roles.push('OCRLabel');
    return roles.includes(element.role) && (!menuAnchor || element.rect.height <= 60);
  });
}
function controlForStep(observation: Observation, lesson: Lesson, stepIndex: number): ObservedElement | null {
  const filtered = { ...observation, elements: controlsForStep(observation, lesson, stepIndex) };
  const direct = findTarget(filtered, lesson.steps[stepIndex].targetAliases);
  if (direct || lesson.app !== 'facetime' || !lesson.id.match(/mic|camera/)) return direct;
  // Some AX toggle controls retain their action label while exposing a changed value.
  const original = findTarget(filtered, lesson.steps[0].targetAliases);
  return original && ['AXCheckBox', 'AXToggleButton'].includes(original.role) && ['0', '1', 'true', 'false'].includes(original.value ?? '') ? original : null;
}
function unavailableMenuCommand(observation: Observation, lesson: Lesson, stepIndex: number): boolean {
  if (!observation.trusted || observation.source !== 'accessibility') return false;
  const candidates = controlsForStep(observation, lesson, stepIndex).filter(element =>
    element.role === 'AXMenuItem' && validRect(element.rect) && element.rect.width <= 1600 && element.rect.height <= 500 &&
    matches(element, lesson.steps[stepIndex].targetAliases));
  return candidates.length === 1 && !candidates[0].enabled;
}
const faceTimeSwitches = {
  'facetime-mic': { identifier: 'toggleMicMenuButton', label: 'Microphone', name: 'microphone', action: 'mic-toggle' },
  'facetime-camera': { identifier: 'toggleVideoButton', label: 'Camera', name: 'camera', action: 'camera-toggle' },
} as const;
function faceTimeSwitchFor(lesson: Lesson) {
  return lesson.id === 'facetime-mic' || lesson.id === 'facetime-camera' ? faceTimeSwitches[lesson.id] : null;
}
function neutralSwitchTarget(observation: Observation, lesson: Lesson): ObservedElement | null {
  const spec = faceTimeSwitchFor(lesson);
  if (!spec || !observation.trusted || observation.source !== 'accessibility' || observation.observedBundleId !== bundleIds.facetime || !observation.windowId || !validRect(observation.window)) return null;
  // Identifiers belong to the native app, unlike the observer's generated id.
  // A duplicate identifier (including conflicting values at the same bounds)
  // cannot prove which switch was changed.
  const candidates = observation.elements.filter(element => element.nativeIdentifier === spec.identifier);
  if (candidates.length !== 1) return null;
  const target = candidates[0];
  return target.enabled && target.role === 'AXCheckBox' && target.subrole === 'AXSwitch' &&
    target.label === spec.label && (target.value === '0' || target.value === '1') &&
    validRect(target.rect) && target.rect.width <= 1600 && target.rect.height <= 500 &&
    target.rect.x >= observation.window.x - 2 && target.rect.y >= observation.window.y - 2 &&
    target.rect.x + target.rect.width <= observation.window.x + observation.window.width + 2 &&
    target.rect.y + target.rect.height <= observation.window.y + observation.window.height + 2 ? target : null;
}
function sameBounds(a: Rect | undefined, b: Rect): boolean {
  return !!a && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;
}
function instruction(lesson: Lesson, stepIndex: number, target: ObservedElement): string {
  const action = lesson.steps[stepIndex].action;
  const label = (meaning: string) => `“${target.label}”${normalize(target.label) === normalize(meaning) ? '' : ` (${meaning})`}`;
  if (action === 'open-view-menu') return `Click ${label('View')} in the top menu bar.`;
  if (action === 'open-bookmarks-menu') return `Click ${label('Bookmarks')} in the top menu bar.`;
  if (action === 'open-history-menu') return `Click ${label('History')} in the top menu bar.`;
  if (action === 'zoom-in') return `Click ${label('Zoom In')} in the open menu.`;
  if (action === 'show-reader') return `Click ${label('Show Reader')} in the open menu.`;
  if (action === 'add-bookmark') return `Click ${label('Add Bookmark')} in the open menu.`;
  if (action === 'save-bookmark') return `Click ${label('Add')} in the bookmark window.`;
  if (action === 'reopen-closed-tab') return `Click ${label('Reopen Last Closed Tab')} in the open menu.`;
  if (action === 'open-downloads') return `Click ${label('Downloads')} on the left side of Finder.`;
  if (action === 'mic-off' || action === 'mic-on') return 'Click the highlighted microphone button.';
  if (action === 'camera-off' || action === 'camera-on') return 'Click the highlighted camera button.';
  return `Click the highlighted “${target.label}” button.`;
}
export function initialLiveState(): LiveState {
  return { sessionId: '', lessonId: null, status: 'idle', stepIndex: 0, title: '', message: '', why: '', target: null, observationSource: 'none', verification: null, permission: { accessibility: false, screenCapture: false }, canConfirm: false, canComplete: false };
}

type Observer = (bundleId: string, signal: AbortSignal) => Promise<Observation>;
type Timer = ReturnType<typeof setTimeout>;
type SafariConfirmationHistory = { sessionId: string; windowId: string; window: Rect };
export class LiveEngine {
  private state: LiveState = initialLiveState();
  private lesson: Lesson | null = null;
  private epoch = 0;
  private timer?: Timer;
  private targetExpiry?: Timer;
  private inFlightEpoch?: number;
  private abort?: AbortController;
  private armed = false;
  private pauseReason: 'user' | 'permission' | null = null;
  private mediaDirectionChosen = false;
  private lastTimestamp = 0;
  private lastWindow: Rect | null = null;
  private lastWindowId: string | undefined;
  private lastValue: string | undefined;
  private neutralSwitchIdentifier: string | null = null;
  private neutralCallId: string | undefined;
  private lastSwitchRect: Rect | undefined;
  private goalTargetSeen = false;
  private safariConfirmationHistory: SafariConfirmationHistory | null = null;
  constructor(private observe: Observer, private publish: (state: LiveState) => void, private interval = 500) {}
  getState(): LiveState { return structuredClone(this.state); }
  private update(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    const access = this.lesson?.app === 'facetime' || this.lesson?.requiresAccessibility
      ? this.state.permission.accessibility : this.state.permission.accessibility || this.state.permission.screenCapture;
    this.state.canComplete = !!this.state.goal && this.goalTargetSeen && access && !['idle', 'complete', 'permission', 'paused'].includes(this.state.status);
    clearTimeout(this.targetExpiry); this.targetExpiry = undefined;
    if (this.state.target && this.state.status === 'guiding') {
      const token = this.epoch;
      // Native reads can stall. A previously valid rectangle must not remain
      // clickable guidance until the much longer native request timeout.
      const remaining = Math.max(1, targetMaxAgeMs - Math.max(0, Date.now() - this.lastTimestamp));
      this.targetExpiry = setTimeout(() => {
        if (token !== this.epoch || !this.state.target) return;
        this.armed = false;
        this.update({ status: 'observing', target: null, canConfirm: false,
          title: 'Checking button position', message: copy.guide.checking });
      }, remaining);
    }
    this.publish(this.getState());
  }
  private cancel() { ++this.epoch; clearTimeout(this.timer); this.timer = undefined; clearTimeout(this.targetExpiry); this.targetExpiry = undefined; this.abort?.abort(); this.abort = undefined; this.safariConfirmationHistory = null; }
  private rememberSafariFinalTarget(observation: Observation, stepIndex: number, target: ObservedElement | null) {
    if (this.state.goal || this.lesson?.app !== 'safari' || !this.lesson.confirmation ||
        stepIndex !== this.lesson.steps.length - 1 || !target || !observation.trusted ||
        observation.source !== 'accessibility' || !observation.windowId || !validRect(observation.window)) return;
    if (controlsForStep(observation, this.lesson, stepIndex).some(element => !element.enabled &&
        validRect(element.rect) && matches(element, this.lesson!.steps[stepIndex].targetAliases))) return;
    this.safariConfirmationHistory = { sessionId: this.state.sessionId, windowId: observation.windowId, window: { ...observation.window } };
  }
  private validateSafariConfirmationHistory(observation: Observation) {
    const history = this.safariConfirmationHistory;
    if (history && (history.sessionId !== this.state.sessionId || !observation.trusted ||
        observation.source !== 'accessibility' || observation.frontmostBundleId !== bundleIds.safari ||
        (observation.observedBundleId !== undefined && observation.observedBundleId !== bundleIds.safari) ||
        observation.windowId !== history.windowId || !validRect(observation.window) || !sameBounds(history.window, observation.window))) {
      this.safariConfirmationHistory = null;
    }
  }
  start(id: LessonId): LiveState {
    const lesson = lessons.find(item => item.id === id);
    if (!lesson) throw new Error('This guide is not available.');
    return this.begin(lesson);
  }
  startGoal(goal: VoiceGoal): LiveState {
    const lessonId = { mute: 'facetime-mic', unmute: 'facetime-mic', 'camera-off': 'facetime-camera', 'camera-on': 'facetime-camera', 'zoom-in': 'safari-zoom' } as const;
    const lesson = lessons.find(item => item.id === lessonId[goal.id]);
    if (!lesson || lesson.app !== goal.app) throw new Error('This request is not available.');
    return this.begin(lesson, structuredClone(goal));
  }
  private begin(lesson: Lesson, goal?: VoiceGoal): LiveState {
    this.cancel(); this.pauseReason = null; this.lesson = lesson; this.armed = false; this.mediaDirectionChosen = false; this.lastTimestamp = 0; this.lastWindow = null; this.lastWindowId = undefined; this.lastValue = undefined;
    this.neutralSwitchIdentifier = null; this.neutralCallId = undefined; this.lastSwitchRect = undefined;
    this.goalTargetSeen = false;
    this.state = { ...initialLiveState(), sessionId: randomUUID(), lessonId: lesson.id, status: 'observing', currentAction: lesson.steps[0].action, title: goal?.label ?? lesson.steps[0].title, message: copy.guide.checking, why: goal ? '' : lesson.steps[0].why,
      ...(goal ? { goal, completionMode: 'manual' as const } : {}) };
    this.publish(this.getState()); void this.poll(this.epoch); return this.getState();
  }
  switchLesson(id: LessonId): LiveState {
    if (this.lesson?.app !== 'facetime' || this.state.status === 'idle' || !lessons.some(lesson => lesson.id === id && lesson.app === 'facetime')) {
      throw new Error('Choose a FaceTime guide while a FaceTime guide is open.');
    }
    return this.start(id);
  }
  stop() { this.cancel(); this.pauseReason = null; this.lesson = null; this.armed = false; this.goalTargetSeen = false; this.state = initialLiveState(); this.publish(this.getState()); }
  pause(reason: 'user' | 'permission' = 'user') {
    if (!this.lesson || this.state.status === 'complete') return;
    // Opening Settings must not erase a deliberate user pause.
    if (reason === 'permission' && this.state.status === 'paused' && this.pauseReason === 'user') return;
    this.pauseReason = reason;
    if (reason === 'user') this.mediaDirectionChosen = true;
    this.cancel(); this.update({ status: 'paused', target: null, canConfirm: false, message: copy.guide.paused });
  }
  canRecoverPermissionFor(bundleId: string): boolean {
    return !!this.lesson && bundleIds[this.lesson.app] === bundleId &&
      (this.state.status === 'permission' || (this.state.status === 'paused' && this.pauseReason === 'permission'));
  }
  recoverPermissionFor(bundleId: string): boolean {
    if (!this.canRecoverPermissionFor(bundleId)) return false;
    this.retry(); return true;
  }
  resume() { if (!this.lesson || this.state.status !== 'paused') return; this.pauseReason = null; this.cancel(); this.armed = false; this.update({ status: 'observing', target: null, canConfirm: false, message: copy.guide.checking }); void this.poll(this.epoch); }
  retry() { if (!this.lesson || this.state.status === 'complete') return; this.pauseReason = null; this.cancel(); this.armed = false; this.update({ status: 'observing', target: null, canConfirm: false, message: copy.guide.checking }); void this.poll(this.epoch); }
  confirm() {
    if (this.state.canConfirm && this.lesson?.confirmation && this.state.stepIndex === this.lesson.steps.length - 1 && this.state.status === 'waiting-control') this.finish('self-confirmed');
  }
  completeGoal(): void {
    if (this.state.goal && this.state.canComplete) this.finish('self-confirmed');
  }
  private finish(verification: 'observed' | 'self-confirmed') {
    if (this.state.goal) {
      this.cancel();
      this.update({ status: 'complete', target: null, canConfirm: false, verification: 'self-confirmed', title: 'Complete', message: 'You marked this request complete.', why: '' });
      return;
    }
    const neutral = this.lesson && this.neutralSwitchIdentifier ? faceTimeSwitchFor(this.lesson) : null;
    this.cancel(); this.update({ status: 'complete', target: null, canConfirm: false, verification, title: copy.result.title, message: verification === 'observed' ? copy.result.observed : copy.result.selfConfirmed, why: neutral ? `You practiced using the FaceTime ${neutral.name} switch.` : this.lesson?.outcome ?? '' });
  }
  private advance(observation: Observation) {
    if (!this.lesson) return;
    if (this.state.stepIndex + 1 >= this.lesson.steps.length) { this.finish('observed'); return; }
    this.armed = false;
    const stepIndex = this.state.stepIndex + 1;
    const step = this.lesson.steps[stepIndex];
    const target = controlForStep(observation, this.lesson, stepIndex);
    this.armed = !!target;
    this.lastValue = target?.value;
    this.rememberSafariFinalTarget(observation, stepIndex, target);
    this.update({ stepIndex, currentAction: step.action, title: step.title, message: target ? instruction(this.lesson, stepIndex, target) : copy.error.targetMissingDescription, why: step.why, target: target?.rect ?? null, status: target ? 'guiding' : 'waiting-control', canConfirm: false });
  }
  private acceptGoal(observation: Observation) {
    const goal = this.state.goal;
    const lesson = this.lesson;
    if (!goal || !lesson) return;
    if (goal.id === 'zoom-in') {
      const zoom = controlForStep(observation, lesson, 1);
      const view = controlForStep(observation, lesson, 0);
      // An observed unavailable command is different from a menu we cannot
      // read yet. Do not send the learner back to View while it is already open.
      if (!zoom && unavailableMenuCommand(observation, lesson, 1)) {
        this.update({ status: 'waiting-control', stepIndex: 1, target: null, currentAction: lesson.steps[1].action,
          title: 'Zoom In is unavailable', message: 'Try another webpage, then open View.',
          why: this.goalTargetSeen ? 'Choose Complete when the text is large enough.' : '', canConfirm: false });
        return;
      }
      // An open, observed Zoom In command is sufficient to guide this goal;
      // seeing View alone never enables completion. Menu closure is not success.
      if (zoom) this.goalTargetSeen = true;
      const target = zoom ?? view;
      const stepIndex = zoom ? 1 : 0;
      this.update({ status: target ? 'guiding' : 'waiting-control', stepIndex, target: target?.rect ?? null,
        currentAction: lesson.steps[stepIndex].action, title: zoom ? 'Click Zoom In' : 'Open View',
        message: target ? instruction(lesson, stepIndex, target) : 'Keep Safari in view. Checking automatically.',
        why: this.goalTargetSeen ? 'Choose Complete when the text is large enough.' : '', canConfirm: false });
      return;
    }
    const spec = faceTimeSwitchFor(lesson)!;
    const kind = spec.name;
    const visibility = observation.controlVisibility?.[kind];
    const clear = visibility === 'visible' || (visibility === undefined && !observation.occluded);
    const waiting = () => this.update({ status: 'waiting-control', target: null, canConfirm: false,
      title: visibility === 'covered' ? `The ${kind} button is covered.` : 'Show call buttons',
      message: visibility === 'covered' ? 'Move the covering window to see it.' : 'Move pointer over FaceTime', why: '' });
    const desired = goal.id === 'mute' ? 'muted' : goal.id === 'unmute' ? 'unmuted' : goal.id === 'camera-off' ? 'off' : 'on';
    if (this.neutralSwitchIdentifier || observation.elements.some(element => element.nativeIdentifier === spec.identifier)) {
      const target = neutralSwitchTarget(observation, lesson);
      if (!target || visibility !== 'visible') { waiting(); return; }
      this.neutralSwitchIdentifier = spec.identifier;
      this.goalTargetSeen = true;
      this.update({ status: 'guiding', stepIndex: 0, target: target.rect, currentAction: spec.action, title: goal.label,
        message: `Click the ${kind} to change its setting.`, why: `Choose Complete when your ${kind} is ${desired}.`, canConfirm: false });
      return;
    }
    const controls = controlsForStep(observation, lesson, 0).filter(element => !element.nativeIdentifier);
    const callConfirmed = observation.observedBundleId === bundleIds.facetime || !!findTarget({ ...observation, elements: controls }, ['End', 'End Call', 'Hang Up', '종료', '통화 종료', '통화 끝내기']);
    if (!clear || !callConfirmed) { waiting(); return; }
    const desiredIndex = goal.id === 'mute' || goal.id === 'camera-off' ? 0 : 1;
    const filtered = { ...observation, elements: controls };
    const target = findTarget(filtered, lesson.steps[desiredIndex].targetAliases);
    const opposite = findTarget(filtered, lesson.steps[1 - desiredIndex].targetAliases);
    if ((!target && !opposite) || (target && opposite)) { waiting(); return; }
    this.goalTargetSeen = true;
    if (opposite) {
      this.update({ status: 'waiting-control', stepIndex: 0, target: null, currentAction: lesson.steps[desiredIndex].action,
        title: `${kind === 'microphone' ? 'Microphone' : 'Camera'} is ${desired}`, message: 'No click needed. Choose Complete.', why: '', canConfirm: false });
      return;
    }
    this.update({ status: 'guiding', stepIndex: 0, target: target!.rect, currentAction: lesson.steps[desiredIndex].action,
      title: goal.label, message: instruction(lesson, desiredIndex, target!), why: `Choose Complete when your ${kind} is ${desired}.`, canConfirm: false });
  }
  private accept(observation: Observation) {
    if (!this.lesson) return;
    // Reject stale samples before they can change permission or app context.
    if (observation.timestamp <= this.lastTimestamp || Date.now() - observation.timestamp > targetMaxAgeMs || observation.timestamp > Date.now() + 2000) {
      this.armed = false;
      this.safariConfirmationHistory = null;
      this.update({ status: 'observing', target: null, contextWindow: undefined, canConfirm: false, message: copy.guide.changedScreen }); return;
    }
    this.lastTimestamp = observation.timestamp;
    // A stale rectangle can expire without erasing a prior final control. Only
    // a fresh same-document/access sample may offer learner confirmation later.
    this.validateSafariConfirmationHistory(observation);
    // Metadata is included in the next validated state publication, never alongside an old target.
    this.state = { ...this.state, permission: { accessibility: observation.trusted, screenCapture: observation.screenCapture }, observationSource: observation.source };
    // Without access, native cannot identify a background call. Asking the user
    // to change focus first would hide the only action that can recover guidance.
    const needsAccessibility = this.lesson.app === 'facetime' || this.lesson.requiresAccessibility;
    if ((!observation.trusted && !observation.screenCapture) || (needsAccessibility && !observation.trusted)) {
      this.armed = false; this.lastWindow = null; this.lastWindowId = undefined;
      this.update({ status: 'permission', target: null, contextWindow: undefined, canConfirm: false, title: copy.error.permissionTitle, message: needsAccessibility ? copy.permissions.accessibilityDescription : copy.permissions.screenDescription }); return;
    }
    const expectedBundle = bundleIds[this.lesson.app];
    // Native marks observedBundleId only after matching the real FaceTime call
    // window. Actual foreground identity stays intact, including HelpOS focus.
    const confirmedFaceTimeWindow = this.lesson.app === 'facetime' && observation.observedBundleId === bundleIds.facetime;
    const wrongObservedApp = observation.observedBundleId !== undefined && observation.observedBundleId !== expectedBundle;
    if (wrongObservedApp || (observation.frontmostBundleId !== expectedBundle && !confirmedFaceTimeWindow)) {
      this.armed = false; this.lastWindow = null; this.lastWindowId = undefined;
      this.update({ status: 'waiting-app', target: null, contextWindow: undefined, canConfirm: false, title: `Bring ${appNames[this.lesson.app]} to the front.`, message: this.lesson.prerequisite }); return;
    }
    if (this.lesson.app === 'facetime' && observation.source !== 'accessibility') {
      // Granted access and usable AX evidence are separate facts. A temporarily
      // missing sample must not ask for permission again or reuse an old target.
      this.armed = false;
      this.update({ status: 'waiting-control', target: null, contextWindow: undefined, canConfirm: false, title: 'Show call buttons', message: 'Move pointer over FaceTime' }); return;
    }
    if (this.lesson.requiresAccessibility && observation.source !== 'accessibility') {
      this.armed = false;
      this.update({ status: 'waiting-control', target: null, contextWindow: undefined, canConfirm: false, title: 'Waiting for Safari controls', message: 'Keep Safari in view. Checking automatically.' }); return;
    }
    if (!validRect(observation.window)) {
      this.armed = false; this.lastWindow = null; this.lastWindowId = undefined;
      this.update({ status: 'waiting-app', target: null, contextWindow: undefined, canConfirm: false, title: `Bring ${appNames[this.lesson.app]} to the front.`, message: this.lesson.prerequisite }); return;
    }
    this.state = { ...this.state, contextWindow: observation.window };
    // A moved window needs a fresh action target before it can provide completion evidence.
    const windowId = (observation as Observation & { windowId?: string }).windowId;
    const windowChanged = (this.lastWindowId && this.lastWindowId !== windowId) || (this.lastWindow && (Math.abs(this.lastWindow.x - observation.window.x) > 2 || Math.abs(this.lastWindow.y - observation.window.y) > 2 || Math.abs(this.lastWindow.width - observation.window.width) > 2 || Math.abs(this.lastWindow.height - observation.window.height) > 2));
    if (windowChanged) { this.armed = false; this.mediaDirectionChosen = true; }
    this.lastWindow = observation.window;
    this.lastWindowId = windowId;
    if (this.state.goal) { this.acceptGoal(observation); return; }
    let step = this.lesson.steps[this.state.stepIndex];
    let target = controlForStep(observation, this.lesson, this.state.stepIndex);
    const visible = (aliases: string[]) => observation.elements.some(element => element.enabled && validRect(element.rect) && matches(element, aliases));
    if (this.lesson.app === 'facetime') {
      const kind = this.lesson.id === 'facetime-mic' ? 'microphone' : this.lesson.id === 'facetime-camera' ? 'camera' : 'end';
      const selectedVisibility = observation.controlVisibility?.[kind];
      const selectedClear = selectedVisibility === 'visible' || (selectedVisibility === undefined && !observation.occluded);
      const showCallButtons = () => this.update({ status: 'waiting-control', target: null, canConfirm: false, title: 'Show call buttons', message: 'Move pointer over FaceTime' });
      const switchSpec = faceTimeSwitchFor(this.lesson);
      if (switchSpec && (this.neutralSwitchIdentifier || observation.elements.some(element => element.nativeIdentifier === switchSpec.identifier))) {
        const switchTarget = neutralSwitchTarget(observation, this.lesson);
        if (!switchTarget || selectedVisibility !== 'visible') {
          this.armed = false; this.lastValue = undefined; this.lastSwitchRect = undefined;
          if (selectedVisibility === 'covered') {
            this.update({ status: 'waiting-control', target: null, canConfirm: false, title: `The ${switchSpec.name} button is covered.`, message: 'Move the covering window to see it.' });
          } else showCallButtons();
          return;
        }
        let stepIndex = this.state.stepIndex;
        if (this.neutralSwitchIdentifier !== switchSpec.identifier || this.neutralCallId !== observation.windowId) {
          // Neither an old label-based step nor a previous call contributes a
          // click to this identifier-scoped lesson.
          stepIndex = 0; this.armed = false; this.lastValue = undefined;
        }
        const changed = this.armed && sameBounds(this.lastSwitchRect, switchTarget.rect) &&
          (this.lastValue === '0' || this.lastValue === '1') && this.lastValue !== switchTarget.value;
        this.neutralSwitchIdentifier = switchSpec.identifier;
        this.neutralCallId = observation.windowId;
        this.mediaDirectionChosen = true;
        if (changed && stepIndex === 1) { this.finish('observed'); return; }
        if (changed) stepIndex = 1;
        this.armed = true;
        this.lastValue = switchTarget.value;
        this.lastSwitchRect = { ...switchTarget.rect };
        this.update({ status: 'guiding', stepIndex, currentAction: `${switchSpec.action}${stepIndex === 1 ? '-again' : ''}`,
          title: `Click ${switchSpec.name}${stepIndex === 1 ? ' again' : ''}`,
          message: `Click the highlighted ${switchSpec.name} switch${stepIndex === 1 ? ' again' : ''}.`,
          why: `This changes the ${switchSpec.name} setting.`, target: switchTarget.rect, canConfirm: false });
        return;
      }
      // A different covered control says nothing about the selected button.
      // Only specific native evidence can identify this button as covered.
      if (selectedVisibility === 'covered') {
        this.armed = false;
        const name = kind === 'end' ? 'Leave call' : kind;
        this.update({ status: 'waiting-control', target: null, canConfirm: false, title: `The ${name} button is covered.`, message: 'Move the covering window to see it.' }); return;
      }
      if (selectedVisibility === undefined && observation.occluded && !target) {
        this.armed = false;
        showCallButtons(); return;
      }
      const endPresent = observation.elements.some(element => element.enabled && validRect(element.rect) && faceTimeControlRoles.includes(element.role) && matches(element, ['End', 'End Call', 'Hang Up', '종료', '통화 종료', '통화 끝내기']));
      // A new media lesson begins with the actual visible action. Reversing a
      // session's two steps still requires two newly observed state changes.
      if (!this.mediaDirectionChosen && selectedClear && !target && this.state.stepIndex === 0 &&
          ['facetime-mic', 'facetime-camera'].includes(this.lesson.id) && (endPresent || confirmedFaceTimeWindow)) {
        const opposite = controlForStep(observation, this.lesson, 1);
        if (opposite && matches(opposite, this.lesson.steps[1].targetAliases)) {
          this.lesson = { ...this.lesson, steps: [this.lesson.steps[1], this.lesson.steps[0]] };
          this.mediaDirectionChosen = true;
          step = this.lesson.steps[0];
          target = opposite;
        }
      }
      if (step.action === 'end-call' && this.armed && (selectedVisibility !== undefined || !observation.occluded) && observation.frontmostBundleId === bundleIds.facetime && visible(['Call Ended', 'Call has ended', '통화가 종료되었습니다', '통화가 종료됨'])) { this.finish('observed'); return; }
      // Missing End is not proof that no call exists. A partial toolbar read
      // needs another observation, while a confirmed call can guide any clear target.
      if (!endPresent && !confirmedFaceTimeWindow) {
        if (step.action !== 'end-call') this.armed = false;
        showCallButtons(); return;
      }
      const oppositeIndex = this.state.stepIndex + 1 < this.lesson.steps.length ? this.state.stepIndex + 1 : 0;
      if (this.armed && selectedClear && !target && !!controlForStep(observation, this.lesson, oppositeIndex) && step.action !== 'end-call') { this.advance(observation); return; }
      if (this.armed && target && ['AXCheckBox', 'AXToggleButton'].includes(target.role) && this.lastValue !== undefined && this.lastValue !== target.value) {
        // A boolean change is not enough to infer muted/camera-off without a validated app mapping.
        this.update({ status: 'waiting-control', target: null, canConfirm: false, title: 'HelpOS could not confirm the button state.', message: 'Keep the call buttons visible. Checking automatically.' }); return;
      }
      if (!target) { showCallButtons(); return; }
    }
    if (this.lesson.app === 'safari') {
      const finalIndex = this.lesson.steps.length - 1;
      const finalControls = controlsForStep(observation, this.lesson, finalIndex).filter(element =>
        validRect(element.rect) && matches(element, this.lesson!.steps[finalIndex].targetAliases));
      const finalTarget = controlForStep(observation, this.lesson, finalIndex);
      const invalidFinalEvidence = finalControls.some(element => !element.enabled) || (finalControls.length > 0 && !finalTarget);
      if (invalidFinalEvidence) this.safariConfirmationHistory = null;
      // Start Page (or a page at its zoom limit) can expose a disabled Zoom In.
      // An open menu is not a reason to keep highlighting View, nor is an
      // unavailable command evidence that the learner enlarged the page.
      if (this.lesson.id === 'safari-zoom' && !controlForStep(observation, this.lesson, 1) &&
          unavailableMenuCommand(observation, this.lesson, 1)) {
        this.armed = false;
        this.update({ status: 'waiting-control', target: null, canConfirm: false,
          title: 'Zoom In is unavailable', message: 'Try another webpage, then open View.', why: '' }); return;
      }
      const nextIndex = this.state.stepIndex + 1;
      const nextTarget = nextIndex < this.lesson.steps.length ? controlForStep(observation, this.lesson, nextIndex) : null;
      // A freshly observed enabled Zoom In is enough to guide it, even if the
      // previous sample was disabled or the guide started with View open.
      if ((this.armed || this.lesson.id === 'safari-zoom') && nextTarget) { this.advance(observation); return; }
      const menuAnchor = controlForStep(observation, this.lesson, 0);
      const finalControlPresent = controlsForStep(observation, this.lesson, this.state.stepIndex).some(element => validRect(element.rect) && matches(element, step.targetAliases));
      // A closed menu/sheet can also mean Cancel. Only the learner can confirm
      // the outcome, after this session actually observed its final control.
      if (this.safariConfirmationHistory && !finalControlPresent && menuAnchor && nextIndex === this.lesson.steps.length && this.lesson.confirmation) {
        this.update({ status: 'waiting-control', target: null, canConfirm: true, title: this.lesson.confirmation.title, message: copy.guide.confirmDescription, why: this.lesson.confirmation.label }); return;
      }
      const command = this.lesson.steps[1];
      const readerAlreadyOn = this.lesson.id === 'safari-reader' && this.state.stepIndex === 0 && observation.elements.some(element => element.enabled && element.role === 'AXMenuItem' && validRect(element.rect) && matches(element, ['Hide Reader', '읽기 도구 가리기']));
      if (readerAlreadyOn) {
        this.armed = false;
        this.update({ status: 'waiting-control', target: null, canConfirm: false, title: 'Reader is already on', message: 'Turn Reader off in View to try this guide.' }); return;
      }
      const disabledCommand = observation.elements.some(element => !element.enabled && element.role === 'AXMenuItem' && validRect(element.rect) && matches(element, command.targetAliases));
      if (disabledCommand && ['safari-reader', 'safari-reopen-tab'].includes(this.lesson.id)) {
        this.armed = false;
        this.update({ status: 'waiting-control', target: null, canConfirm: false,
          title: this.lesson.id === 'safari-reader' ? 'Reader is not available here' : 'No closed tab to reopen',
          message: this.lesson.id === 'safari-reader' ? 'Open an article, then open View.' : 'Close a spare tab, then open History.' }); return;
      }
      if (!target && !nextTarget) {
        if (finalControlPresent || !menuAnchor) {
          this.armed = false;
          this.safariConfirmationHistory = null;
        }
        const menuName = step.action === 'save-bookmark' ? 'Bookmarks' : this.lesson.id === 'safari-reopen-tab' ? 'History' : this.lesson.id === 'safari-bookmark' ? 'Bookmarks' : 'View';
        this.update({ status: 'waiting-control', target: null, canConfirm: false,
          title: step.action === 'save-bookmark' ? 'Open the bookmark window' : `Open ${menuName}`,
          message: step.action === 'save-bookmark' ? 'Choose Add Bookmark from Bookmarks.' : `Use ${menuName} in the top menu bar. Checking automatically.` }); return;
      }
    }
    if (this.lesson.id === 'finder-downloads') {
      const selected = observation.elements.some(element => matches(element, step.targetAliases) && validRect(element.rect) && (element.selected === true || ['AXWindow', 'OCRWindowTitle'].includes(element.role)));
      if (this.armed && selected) { this.finish('observed'); return; }
      if (!this.armed && selected) { this.update({ status: 'waiting-control', target: null, canConfirm: false, title: 'Downloads is already open.', message: 'Select another folder, then start the guide again to learn where to find Downloads.' }); return; }
    }
    if (target) {
      if (this.lesson.app === 'facetime') this.mediaDirectionChosen = true;
      this.armed = true;
      this.lastValue = target.value;
      this.rememberSafariFinalTarget(observation, this.state.stepIndex, target);
      this.update({ status: 'guiding', currentAction: step.action, title: step.title, message: instruction(this.lesson, this.state.stepIndex, target), why: step.why, target: target.rect, canConfirm: false });
    } else this.update({ status: 'waiting-control', target: null, canConfirm: false, title: copy.error.targetMissingTitle, message: copy.error.targetMissingDescription });
  }
  async poll(token = this.epoch): Promise<void> {
    if (token !== this.epoch || !this.lesson || ['paused', 'complete', 'idle'].includes(this.state.status)) return;
    if (this.inFlightEpoch === token) return;
    this.inFlightEpoch = token;
    const startedAt = Date.now();
    clearTimeout(this.timer); this.timer = undefined;
    this.abort = new AbortController();
    try {
      const observation = await this.observe(bundleIds[this.lesson.app], this.abort.signal);
      if (token !== this.epoch) return;
      this.accept(observation);
    } catch (error) {
      if (token !== this.epoch) return;
      this.armed = false;
      this.safariConfirmationHistory = null;
      this.update({ status: 'error', target: null, canConfirm: false, title: copy.error.observationTitle, message: copy.error.observationDescription });
    } finally {
      if (this.inFlightEpoch === token) this.inFlightEpoch = undefined;
    }
    if (token === this.epoch && this.lesson && !['paused', 'complete', 'idle'].includes(this.state.status)) {
      // Count observation work in the cadence. Slow reads still get a short
      // rest, and waiting for app/access or an error backs off to at least 1s.
      const waiting = ['waiting-app', 'permission', 'error'].includes(this.state.status);
      const cadence = waiting ? Math.max(1000, this.interval) : this.interval;
      const delay = Math.max(Math.min(100, this.interval), cadence - (Date.now() - startedAt));
      this.timer = setTimeout(() => void this.poll(token), delay);
    }
  }
}
