import { z } from 'zod';
const request = z.object({ bundleId: z.enum(['com.apple.FaceTime', 'com.apple.Safari', 'com.apple.finder']), activationId: z.string().uuid(), timestamp: z.number().finite().positive() }).strict();
export function hasActivationArgument(argv: readonly string[]) { return argv.some(arg => arg === '--app-help' || arg.startsWith('--app-help=')); }
export function parseActivation(argv: readonly string[]) {
  const keys = ['--app-help', '--activation-id', '--activation-at'];
  const values: string[] = [];
  for (const key of keys) {
    const matches = argv.map((arg, index) => ({ arg, index })).filter(({ arg }) => arg === key || arg.startsWith(key + '='));
    if (matches.length !== 1) return null;
    const { arg, index } = matches[0];
    const value = arg === key ? argv[index + 1] : arg.slice(key.length + 1);
    if (!value || value.startsWith('--')) return null;
    values.push(value);
  }
  const parsed = request.safeParse({ bundleId: values[0], activationId: values[1], timestamp: Number(values[2]) });
  return parsed.success ? parsed.data : null;
}
