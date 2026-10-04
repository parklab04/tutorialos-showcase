import { z } from 'zod';
import { readNativeJSON } from '../../platform/native-observer';
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive().max(20000), height: z.number().positive().max(20000) }).strict();
const schema = z.object({ frontmostBundleId: z.string().max(255), pid: z.number().int().positive().nullable(), window: rect.nullable(), timestamp: z.number().finite() }).strict();
export async function inspectAppContext(library: string) { return schema.parse(await readNativeJSON(library, '--app-context')); }
