import { initialVoiceState, type VoiceGoal, type VoiceState } from '../../../src/features/voice-guide/contracts';
import { parseVoiceGoal } from './intent';

export function voiceErrorMessage(code: string | null): string {
  const messages: Record<string, string> = {
    'speech-denied': 'Allow HelpOS in Mac Settings → Privacy & Security → Speech Recognition, then try again.',
    'microphone-denied': 'Allow HelpOS in Mac Settings → Privacy & Security → Microphone, then try again.',
    'speech-restricted': 'Speech Recognition is restricted on this Mac. Type your request instead.',
    'microphone-restricted': 'Microphone access is restricted on this Mac. Type your request instead.',
    'on-device-unavailable': 'English speech recognition is not available on this Mac. Type your request instead.',
    'missing-usage-description': 'Open the installed HelpOS app to use voice input. You can still type here.',
    'no-speech': 'I did not hear a request. Try again or type below.',
    'authorization-timeout': 'Voice setup timed out. Check Mac permissions, then try again.',
    'recognizer-unavailable': 'Speech recognition is temporarily unavailable. Try again or type below.',
    'microphone-unavailable': 'No microphone is available. Check your input device or type below.',
  };
  return messages[code ?? ''] ?? 'Voice input stopped. Try again or type your request.';
}

export interface SpeechSnapshot {
  phase: 'idle' | 'authorizing' | 'listening' | 'finishing' | 'final' | 'cancelled' | 'error';
  transcript: string;
  error: string | null;
}
export interface SpeechDriver {
  start(locale: 'en-US'): Promise<SpeechSnapshot>;
  stop(): Promise<SpeechSnapshot>;
  cancel(): Promise<SpeechSnapshot>;
  poll(): Promise<SpeechSnapshot>;
}
interface Options {
  native: SpeechDriver;
  publish(state: VoiceState): void;
  show(): void;
  hide(): void;
  beforeInput(): void;
  guide(goal: VoiceGoal, isCurrent: () => boolean): Promise<void>;
  interval?: number;
}
export class VoiceController {
  private state = initialVoiceState();
  private epoch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();
  private startedAt = 0;
  private using: number | null = null;
  constructor(private options: Options) {}
  getState(): VoiceState { return structuredClone(this.state); }
  private update(patch: Partial<VoiceState>) { this.state = { ...this.state, ...patch }; this.options.publish(this.getState()); }
  private invalidate() { clearTimeout(this.timer); this.using = null; return ++this.epoch; }
  private native<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  setShortcut(available: boolean) { this.update({ shortcutAvailable: available }); }
  open() {
    this.cancel(false);
    this.options.beforeInput();
    this.options.show();
  }
  cancel(hide = true): VoiceState {
    this.invalidate();
    void this.native(() => this.options.native.cancel()).catch(() => undefined);
    this.update({ phase: 'idle', transcript: '', goal: null, message: '' });
    if (hide) this.options.hide();
    return this.getState();
  }
  async start(): Promise<VoiceState> {
    const token = this.invalidate();
    this.options.beforeInput(); this.options.show(); this.startedAt = Date.now();
    this.update({ phase: 'requesting', transcript: '', goal: null, message: 'Allow Microphone and Speech Recognition when your Mac asks.' });
    try {
      const result = await this.native(async () => {
        await this.options.native.cancel();
        return token === this.epoch ? this.options.native.start('en-US') : null;
      });
      if (token === this.epoch && result) this.accept(result, token);
    } catch { if (token === this.epoch) this.fail('Voice input is unavailable. You can type your request.'); }
    return this.getState();
  }
  async stop(): Promise<VoiceState> {
    if (this.state.phase === 'requesting') return this.cancel(false);
    if (this.state.phase !== 'listening') return this.getState();
    clearTimeout(this.timer);
    const token = this.epoch;
    this.update({ phase: 'processing', message: 'Finishing your request…' });
    try { const result = await this.native(() => this.options.native.stop()); if (token === this.epoch) this.accept(result, token); }
    catch { if (token === this.epoch) this.fail('Could not finish recording. Please try again or type.'); }
    return this.getState();
  }
  toggle() {
    if (this.state.phase === 'listening') return this.stop();
    if (this.state.phase === 'requesting' || this.state.phase === 'processing') return Promise.resolve(this.cancel());
    return this.start();
  }
  async submit(text: string): Promise<VoiceState> {
    const token = this.invalidate();
    await this.native(() => this.options.native.cancel()).catch(() => undefined);
    if (token !== this.epoch) return this.getState();
    const transcript = text.trim().slice(0, 500);
    const result = parseVoiceGoal(transcript);
    this.update({ transcript, ...result, phase: result.goal ? 'review' : 'error' });
    return this.getState();
  }
  async useGoal() {
    if (this.using !== null || this.state.phase !== 'review' || !this.state.goal) return;
    const goal = { ...this.state.goal };
    const token = this.invalidate();
    this.using = token;
    try {
      await this.native(() => this.options.native.cancel());
      if (token !== this.epoch) return;
      this.options.hide();
      await this.options.guide(goal, () => token === this.epoch);
      if (token === this.epoch) this.update({ phase: 'idle', transcript: '', goal: null, message: '' });
    } catch {
      if (token === this.epoch) { this.options.show(); this.fail('Could not open the guide. Please try again.'); }
    } finally {
      // A cancelled goal may settle after a new request starts opening its app.
      // Only the request owning this token can release its duplicate-use guard.
      if (this.using === token) this.using = null;
    }
  }
  private fail(message: string) {
    this.invalidate();
    void this.native(() => this.options.native.cancel()).catch(() => undefined);
    this.update({ phase: 'error', goal: null, message });
  }
  private accept(value: SpeechSnapshot, token: number) {
    if (token !== this.epoch) return;
    clearTimeout(this.timer);
    if (value.phase === 'error') { this.fail(voiceErrorMessage(value.error)); return; }
    if (value.phase === 'final') {
      const transcript = value.transcript.trim().slice(0, 500);
      const parsed = parseVoiceGoal(transcript);
      this.update({ transcript, ...parsed, phase: parsed.goal ? 'review' : 'error' });
      void this.native(() => this.options.native.cancel()).catch(() => undefined);
      return;
    }
    if (value.phase === 'cancelled' || value.phase === 'idle') { this.fail('No speech was captured. Try again or type your request.'); return; }
    const phase = value.phase === 'authorizing' ? 'requesting' : value.phase === 'finishing' ? 'processing' : 'listening';
    this.update({ phase, transcript: value.transcript.slice(0, 500), message: phase === 'listening' ? 'Listening… Say one request.' : phase === 'processing' ? 'Finishing your request…' : 'Allow Microphone and Speech Recognition in Mac settings.' });
    if (Date.now() - this.startedAt > 120_000) { this.fail('Voice setup timed out. Please try again.'); return; }
    this.timer = setTimeout(() => void this.poll(token), this.options.interval ?? 200);
  }
  private async poll(token: number) {
    if (token !== this.epoch) return;
    try { const next = await this.native(() => this.options.native.poll()); this.accept(next, token); }
    catch { if (token === this.epoch) this.fail('Voice input stopped. Please try again or type.'); }
  }
  dispose() { this.cancel(); }
}
