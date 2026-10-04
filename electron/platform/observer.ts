import { readNativeJSON } from './native-observer';
import { z } from 'zod';
import type { Observation } from '../../src/features/live-guide/contracts';

const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() });
const schema = z.object({
  trusted: z.boolean(), screenCapture: z.boolean(), frontmostBundleId: z.string().max(200), frontmostName: z.string().max(200), timestamp: z.number().finite(), source: z.enum(['accessibility', 'ocr', 'none']), window: rect.nullable(), windowId: z.string().max(100).optional(), observedBundleId: z.literal('com.apple.FaceTime').optional(), occluded: z.boolean().optional(), controlVisibility: z.object({ microphone: z.enum(['visible', 'covered', 'missing']), camera: z.enum(['visible', 'covered', 'missing']), end: z.enum(['visible', 'covered', 'missing']) }).strict().optional(),
  elements: z.array(z.object({ id: z.string().max(300), role: z.string().max(100), label: z.string().max(200), value: z.string().max(100).optional(), enabled: z.boolean(), rect, selected: z.boolean().optional(), scope: z.literal('bookmark-sheet').optional(), nativeIdentifier: z.enum(['toggleVideoButton', 'toggleMicMenuButton']).optional(), subrole: z.literal('AXSwitch').optional() })).max(250),
});
export function parseObservation(value: unknown): Observation { return schema.parse(value) as Observation; }
export async function runObserver(library: string, bundleId?: string, signal?: AbortSignal): Promise<Observation> {
  let value: unknown;
  try { value = await readNativeJSON(library, bundleId ? `--observe ${bundleId}` : '--probe', signal); }
  catch { throw new Error('HelpOS could not check the current screen.'); }
  try { return parseObservation(value); }
  catch { throw new Error('HelpOS could not read the screen information.'); }
}
