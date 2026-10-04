import { readNativeJSON } from '../../platform/native-observer';
import { z } from 'zod';

const rect = z.object({
  x: z.number().finite().min(-39999).max(39999), y: z.number().finite().min(-39999).max(39999),
  width: z.number().finite().min(3).max(11999), height: z.number().finite().min(3).max(11999),
}).strict();
const schema = z.object({
  accessibility: z.boolean(), state: z.enum(['active', 'inactive', 'unknown']),
  callId: z.string().regex(/^\d+:\d+$/).max(50).nullable(), window: rect.nullable(),
  timestamp: z.number().finite().nonnegative(),
  controlVisibility: z.object({ microphone: z.enum(['visible', 'covered', 'missing']), camera: z.enum(['visible', 'covered', 'missing']), end: z.enum(['visible', 'covered', 'missing']) }).strict().optional(),
  controls: z.array(z.object({ kind: z.enum(['microphone', 'camera', 'end']), rect }).strict()).max(3).optional(),
}).strict().superRefine((value, context) => {
  if ((!value.accessibility && value.state !== 'unknown') || (value.state === 'active' && !value.window) || (value.state !== 'active' && (value.callId !== null || value.window !== null))) {
    context.addIssue({ code: 'custom', message: 'Inconsistent FaceTime call observation.' });
  }
  const controls = value.controls ?? [];
  if (new Set(controls.map(control => control.kind)).size !== controls.length || controls.some(({ rect }) =>
    value.state !== 'active' || !value.window || rect.x < value.window.x - 2 || rect.y < value.window.y - 2 ||
    rect.x + rect.width > value.window.x + value.window.width + 2 || rect.y + rect.height > value.window.y + value.window.height + 2
  )) context.addIssue({ code: 'custom', message: 'Invalid FaceTime control locations.' });
});
export type FaceTimeCallObservation = z.infer<typeof schema>;
export function parseFaceTimeObservation(value: unknown): FaceTimeCallObservation { return schema.parse(value); }

export async function runFaceTimeObserver(library: string, signal?: AbortSignal): Promise<FaceTimeCallObservation> {
  let value: unknown;
  try { value = await readNativeJSON(library, '--facetime-call', signal); }
  catch { throw new Error('HelpOS could not check the FaceTime call.'); }
  try { return parseFaceTimeObservation(value); }
  catch { throw new Error('HelpOS could not read the FaceTime call information.'); }
}
