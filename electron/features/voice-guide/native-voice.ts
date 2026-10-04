import koffi from 'koffi';
import { z } from 'zod';

export type NativeVoiceLocale = 'en-US' | 'ko-KR';
const authorization = z.enum(['not-determined', 'authorized', 'denied', 'restricted']);
const snapshot = z.object({
  phase: z.enum(['idle', 'authorizing', 'listening', 'finishing', 'final', 'cancelled', 'error']),
  sessionId: z.string().max(64).nullable(),
  locale: z.enum(['en-US', 'ko-KR']),
  transcript: z.string().max(8000), // Swift bounds 2,000 Unicode characters.
  error: z.string().max(100).nullable(),
  microphone: authorization,
  speech: authorization,
  onDeviceSupported: z.boolean(),
  listening: z.boolean(),
});

export type NativeVoiceSnapshot = z.infer<typeof snapshot>;
export interface NativeVoiceInput {
  start(locale?: NativeVoiceLocale): Promise<NativeVoiceSnapshot>;
  stop(): Promise<NativeVoiceSnapshot>;
  cancel(): Promise<NativeVoiceSnapshot>;
  poll(): Promise<NativeVoiceSnapshot>;
  status(locale?: NativeVoiceLocale): Promise<NativeVoiceSnapshot>;
  authorize(locale?: NativeVoiceLocale): Promise<NativeVoiceSnapshot>;
}

const bindings = new Map<string, NativeVoiceInput>();

function loadVoiceBindings(libraryPath: string) {
  // Keep the library loaded. Apple's late speech callbacks still execute its
  // code after cancellation, and unloading would invalidate those callbacks.
  const library = koffi.load(libraryPath);
  const free = library.func('void helpos_voice_free(void *pointer)');
  const functions = {
    start: library.func('void *helpos_voice_start(const char *locale)'),
    stop: library.func('void *helpos_voice_stop()'),
    cancel: library.func('void *helpos_voice_cancel()'),
    poll: library.func('void *helpos_voice_poll()'),
    status: library.func('void *helpos_voice_status(const char *locale)'),
    authorize: library.func('void *helpos_voice_authorize(const char *locale)'),
  };
  return { library, functions, free };
}

export function createNativeVoiceInput(libraryPath: string): NativeVoiceInput {
  const cached = bindings.get(libraryPath);
  if (cached) return cached;
  // Creating the feature before app.ready must not load Apple's frameworks or
  // fail startup when a development native library has not yet been built.
  let native: ReturnType<typeof loadVoiceBindings> | undefined;
  const invoke = (command: keyof ReturnType<typeof loadVoiceBindings>['functions'], locale?: NativeVoiceLocale): Promise<NativeVoiceSnapshot> => new Promise((resolve, reject) => {
    try {
      const { functions, free } = native ??= loadVoiceBindings(libraryPath);
      const callback = (error: Error | null, pointer: bigint | null) => {
        if (error) { reject(new Error('Native voice input is unavailable.')); return; }
        if (!pointer) { reject(new Error('Native voice input returned no state.')); return; }
        try {
          const text: string = koffi.decode(pointer, 'char', -1);
          if (text.length > 32 * 1024) throw new Error('Invalid native voice state.');
          resolve(snapshot.parse(JSON.parse(text)));
        } catch {
          // Never propagate native output or validation errors containing speech.
          reject(new Error('Native voice input returned an invalid state.'));
        } finally { free(pointer); }
      };
      // Swift dispatches to AppKit main; synchronous FFI would deadlock Electron.
      if (locale !== undefined) functions[command].async(locale, callback);
      else functions[command].async(callback);
    } catch { reject(new Error('Native voice input is unavailable.')); }
  });
  const api: NativeVoiceInput = {
    start: (locale = 'en-US') => invoke('start', locale),
    stop: () => invoke('stop'),
    cancel: () => invoke('cancel'),
    poll: () => invoke('poll'),
    status: (locale = 'en-US') => invoke('status', locale),
    authorize: (locale = 'en-US') => invoke('authorize', locale),
  };
  bindings.set(libraryPath, api);
  return api;
}
