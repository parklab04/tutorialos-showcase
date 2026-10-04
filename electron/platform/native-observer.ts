import koffi from 'koffi';

type Callback = (error: Error | null, text?: string) => void;
export type NativeRead = (command: string, callback: Callback) => void;
const bindings = new Map<string, NativeRead>();

function binding(libraryPath: string): NativeRead {
  const cached = bindings.get(libraryPath);
  if (cached) return cached;
  // Keep the library loaded for the process lifetime. Unloading it while Swift
  // finishes a cancelled observation would invalidate executing native code.
  const library = koffi.load(libraryPath);
  const observe = library.func('void *helpos_observe(const char *command)');
  const free = library.func('void helpos_free(void *pointer)');
  const read: NativeRead = (command, callback) => {
    // The worker shares HelpOS's TCC identity without blocking Electron's UI.
    observe.async(command, (error: Error | null, pointer: bigint | null) => {
      if (error) { callback(error); return; }
      if (!pointer) { callback(new Error('Native observer returned no data.')); return; }
      let text: string;
      try { text = koffi.decode(pointer, 'char', -1); }
      catch (error) { callback(error instanceof Error ? error : new Error('Invalid native output.')); return; }
      finally { free(pointer); }
      callback(null, text);
    });
  };
  bindings.set(libraryPath, read);
  return read;
}

export function createNativeReader(read: NativeRead, timeoutMs = 6000) {
  return (command: string, signal?: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Observation cancelled.')); return; }
    let settled = false;
    const finish = (error: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) { reject(error); return; }
      try {
        if (!text || text.length > 256 * 1024) throw new Error('Invalid native output size.');
        const value: unknown = JSON.parse(text);
        if (value && typeof value === 'object' && 'error' in value) throw new Error('Native observation unavailable.');
        resolve(value);
      } catch (error) { reject(error); }
    };
    const abort = () => finish(new Error('Observation cancelled.'));
    const timer = setTimeout(() => finish(new Error('Observation timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    // Cancelling rejects promptly; the eventual native callback still decodes and
    // frees its owned allocation before the settled result is discarded here.
    try { read(command, finish); }
    catch (error) { finish(error instanceof Error ? error : new Error('Native observer unavailable.')); }
  });
}

export async function readNativeJSON(libraryPath: string, command: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new Error('Observation cancelled.');
  return createNativeReader(binding(libraryPath))(command, signal);
}
