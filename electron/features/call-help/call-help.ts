import { randomUUID } from 'node:crypto';
import type { CallControl, CallHelpState } from '../../../src/features/call-help/contracts';
import type { Rect } from '../../../src/shared/geometry';

export interface CallObservation {
  accessibility: boolean;
  state: 'active' | 'inactive' | 'unknown';
  callId: string | null;
  window: Rect | null;
  timestamp: number;
  controls?: CallControl[];
}
interface Options {
  observe: (signal: AbortSignal) => Promise<CallObservation>;
  publish: (state: CallHelpState) => void;
  canOffer: () => boolean;
  interval?: number;
}

// Missing controls are unknown, not a call ending. A dismissed offer stays
// dismissed until three explicit inactive observations establish a new session.
export class CallHelpMonitor {
  private state: CallHelpState = { enabled: false, status: 'off', suggestion: null };
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private epoch = 0;
  private inactiveCount = 0;
  private activeCount = 0;
  private offered = false;
  private hasActiveContext = false;
  private lastTimestamp = 0;
  private anchor: Rect | null = null;
  constructor(private options: Options) {}
  getState(): CallHelpState { return structuredClone(this.state); }
  getAnchor(): Rect | null { return this.anchor ? { ...this.anchor } : null; }
  private update(patch: Partial<CallHelpState>) {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next; this.options.publish(this.getState());
  }
  private hideUnavailableSuggestion(status: 'permission' | 'unavailable') {
    this.activeCount = 0; this.inactiveCount = 0;
    // Only an automatically hidden detected offer may be presented again.
    // Explicit dismissals, previews and off/on have already removed that offer.
    if (this.state.suggestion?.source === 'detected') this.offered = false;
    this.update({ status, suggestion: this.state.suggestion?.source === 'preview' ? this.state.suggestion : null });
  }
  private cancel() { ++this.epoch; clearTimeout(this.timer); this.timer = undefined; this.abort?.abort(); this.abort = undefined; }
  setEnabled(enabled: boolean) {
    if (enabled === this.state.enabled) return;
    this.cancel(); this.activeCount = 0; this.inactiveCount = 0;
    // Preserve dismissal across a quick off/on so it cannot interrupt the same call.
    this.update({ enabled, status: enabled ? 'watching' : 'off', suggestion: null });
    if (enabled) void this.poll(this.epoch);
  }
  preview() {
    this.anchor = null;
    this.update({ suggestion: { id: randomUUID(), source: 'preview' } });
  }
  dismiss() {
    if (this.state.suggestion?.source === 'detected') this.offered = true;
    this.update({ suggestion: null });
  }
  // The outer controller may already show an activation offer or manual guide.
  // Consume only a positively observed call, never a lobby or unknown state.
  consumeActiveCall() {
    if (!this.hasActiveContext) return;
    this.offered = true;
    if (this.state.suggestion?.source === 'detected') this.update({ suggestion: null });
  }
  dispose() { this.cancel(); }
  private accept(observation: CallObservation) {
    if (observation.timestamp <= this.lastTimestamp || Date.now() - observation.timestamp > 5000 || observation.timestamp > Date.now() + 2000) {
      this.hideUnavailableSuggestion('unavailable');
      return;
    }
    this.lastTimestamp = observation.timestamp;
    if (!observation.accessibility) {
      this.hideUnavailableSuggestion('permission');
      return;
    }
    this.update({ status: 'watching' });
    if (observation.state === 'unknown') { this.activeCount = 0; this.inactiveCount = 0; return; }
    if (observation.state === 'inactive') {
      this.activeCount = 0;
      if (++this.inactiveCount >= 3) {
        this.offered = false; this.hasActiveContext = false; this.anchor = null;
        if (this.state.suggestion?.source === 'detected') this.update({ suggestion: null });
      }
      return;
    }
    this.inactiveCount = 0;
    this.hasActiveContext = true;
    this.anchor = observation.window;
    if (this.state.suggestion?.source === 'detected') this.update({ suggestion: { ...this.state.suggestion, ...(observation.window ? { window: observation.window } : {}), controls: observation.controls ?? [] } });
    if (++this.activeCount >= 2 && !this.offered && !this.state.suggestion && this.options.canOffer()) {
      this.offered = true;
      this.update({ suggestion: { id: randomUUID(), source: 'detected', ...(observation.window ? { window: observation.window } : {}), controls: observation.controls ?? [] } });
    }
  }
  async poll(token = this.epoch): Promise<void> {
    if (!this.state.enabled || token !== this.epoch) return;
    clearTimeout(this.timer); this.timer = undefined;
    this.abort = new AbortController();
    try {
      const observation = await this.options.observe(this.abort.signal);
      if (token === this.epoch && this.state.enabled) this.accept(observation);
    } catch {
      if (token === this.epoch) {
        this.hideUnavailableSuggestion('unavailable');
      }
    }
    if (token === this.epoch && this.state.enabled) this.timer = setTimeout(() => void this.poll(token), this.options.interval ?? 1500);
  }
}
