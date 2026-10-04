import type { Rect } from '../../shared/geometry';

export type SupportedApp = 'facetime' | 'safari' | 'finder';

export interface CallControl { kind: 'microphone' | 'camera' | 'end'; rect: Rect }
export interface CallHelpState {
  enabled: boolean;
  status: 'off' | 'watching' | 'permission' | 'requires-approval' | 'unavailable';
  suggestion: { id: string; source: 'detected' | 'preview' | 'activation'; app?: SupportedApp; window?: Rect; controls?: CallControl[] } | null;
}
