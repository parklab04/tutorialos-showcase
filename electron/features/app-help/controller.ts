import { CallHelpMonitor, type CallObservation } from '../call-help/call-help';
import { randomUUID } from 'node:crypto';
import type { CallHelpState, SupportedApp } from '../../../src/features/call-help/contracts';
import type { Rect } from '../../../src/shared/geometry';

export interface AppActivation { bundleId: string; activationId: string; timestamp: number }
export interface AppInspection { frontmostBundleId: string; window: Rect | null; timestamp: number }
interface Options {
  inspect: () => Promise<AppInspection>;
  observeCall?: (signal: AbortSignal) => Promise<CallObservation>;
  callInterval?: number;
  publish: (state: CallHelpState) => void;
  canOffer: () => boolean;
  canRecoverGuide?: (bundleId: string) => boolean;
  recoverGuide?: (bundleId: string) => boolean;
}

const supportedApps = new Map<string, SupportedApp>([
  ['com.apple.FaceTime', 'facetime'], ['com.apple.Safari', 'safari'], ['com.apple.finder', 'finder'],
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fresh = (timestamp: number, now: number) => Number.isFinite(timestamp) && timestamp >= now - 15000 && timestamp <= now + 2000;
const validWindow = (rect: Rect | null): rect is Rect => !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;

// The native watcher owns visit identities: HelpOS focus does not create a
// new visit. This controller accepts each visit once and never queues it.
export class AppHelpController {
  private state: CallHelpState = { enabled: false, status: 'off', suggestion: null };
  private anchor: Rect | null = null;
  private generation = 0;
  private pendingActivation: number | null = null;
  private disposed = false;
  private lastTimestamp = -Infinity;
  private seen = new Set<string>();
  private callMonitor?: CallHelpMonitor;
  constructor(private options: Options) {
    if (options.observeCall) this.callMonitor = new CallHelpMonitor({
      observe: options.observeCall,
      interval: options.callInterval ?? 1000,
      canOffer: () => !this.disposed && this.state.enabled && this.pendingActivation === null && !this.state.suggestion && this.options.canOffer(),
      publish: state => this.acceptCallState(state),
    });
  }
  private acceptCallState(state: CallHelpState) {
    if (this.disposed) return;
    const incoming = state.suggestion;
    if (incoming?.source === 'detected') {
      if (!this.state.enabled || !this.options.canOffer()) return;
      // App offers, previews and live guides share one presentation owner.
      if (this.state.suggestion && !(this.state.suggestion.source === 'detected' && this.state.suggestion.id === incoming.id)) return;
      ++this.generation;
      this.anchor = incoming.window ? { ...incoming.window } : null;
      this.update({ status: 'watching', suggestion: { ...incoming, app: 'facetime' } });
    } else if (this.state.suggestion?.source === 'detected') {
      ++this.generation; this.pendingActivation = null; this.anchor = null;
      this.update({ suggestion: null });
    }
  }
  getState(): CallHelpState { return structuredClone(this.state); }
  getAnchor(): Rect | null { return this.anchor ? { ...this.anchor } : null; }
  private update(patch: Partial<CallHelpState>) {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.options.publish(this.getState());
  }
  setEnabled(enabled: boolean) {
    if (this.disposed || this.state.enabled === enabled) return;
    ++this.generation; this.pendingActivation = null; this.anchor = null;
    this.update({ enabled, status: enabled ? 'watching' : 'off', suggestion: null });
    this.callMonitor?.setEnabled(enabled);
  }
  preview(app: SupportedApp = 'facetime') {
    if (this.disposed || ![...supportedApps.values()].includes(app)) return;
    ++this.generation; this.pendingActivation = null; this.anchor = null;
    this.callMonitor?.consumeActiveCall();
    this.update({ suggestion: { id: randomUUID(), source: 'preview', app } });
  }
  suppressForGuide() {
    // Repeated publications from the same guide must not cancel an awaited
    // permission-recovery inspection. Actual close actions still use dismiss.
    this.callMonitor?.consumeActiveCall();
    if (this.state.suggestion) this.dismiss();
  }
  dismiss() {
    ++this.generation; this.pendingActivation = null; this.anchor = null;
    this.callMonitor?.consumeActiveCall();
    this.update({ suggestion: null });
  }
  dispose() {
    this.disposed = true;
    this.callMonitor?.dispose();
    ++this.generation; this.pendingActivation = null; this.anchor = null;
    this.update({ enabled: false, status: 'off', suggestion: null });
  }
  async acceptActivation(event: AppActivation): Promise<void> {
    if (this.disposed) return;
    const app = supportedApps.get(event.bundleId);
    if (!app || typeof event.activationId !== 'string' || !uuid.test(event.activationId) || !fresh(event.timestamp, Date.now()) || event.timestamp <= this.lastTimestamp) return;
    const id = event.activationId.toLowerCase();
    if (this.seen.has(id)) return;
    this.lastTimestamp = event.timestamp;
    this.seen.add(id);
    if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    const current = ++this.generation;
    this.pendingActivation = null;
    const canRecover = () => this.options.canRecoverGuide?.(event.bundleId) === true;
    const recoveryVisit = canRecover();
    if (!this.state.enabled || this.state.suggestion?.source === 'preview' || (!this.options.canOffer() && !canRecover())) return;
    // Returning to FaceTime must not replace an already visible call offer.
    if (app === 'facetime' && this.state.suggestion?.source === 'detected') return;
    // Suppress a late call sample while this newer app visit is being checked.
    this.pendingActivation = current;
    const replacingCall = this.state.suggestion?.source === 'detected';
    this.anchor = null;
    this.update({ status: 'watching', suggestion: null });
    if (replacingCall) this.callMonitor?.consumeActiveCall();
    try {
      const inspection = await this.options.inspect();
      if (this.disposed || current !== this.generation || !this.state.enabled || this.getState().suggestion?.source === 'preview' || (!this.options.canOffer() && !canRecover())) return;
      if (!fresh(event.timestamp, Date.now()) || !fresh(inspection.timestamp, Date.now()) || inspection.frontmostBundleId !== event.bundleId || !validWindow(inspection.window)) return;
      // A guide waiting on setup rechecks its real observer instead of silently
      // swallowing this app visit. Explicit Pause never takes this path.
      if (recoveryVisit) {
        if (canRecover()) this.options.recoverGuide?.(event.bundleId);
        return; // Closing the guide must not turn its pending recovery into a new offer.
      }
      if (!this.options.canOffer()) return;
      this.anchor = { ...inspection.window };
      this.update({ status: 'watching', suggestion: { id, source: 'activation', app, window: { ...inspection.window } } });
    } catch {
      if (!this.disposed && current === this.generation && this.state.enabled) this.update({ status: 'unavailable', suggestion: null });
    } finally {
      if (this.pendingActivation === current) this.pendingActivation = null;
    }
  }
}
