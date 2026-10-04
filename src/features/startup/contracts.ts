export interface StartupState {
  available: boolean;
  enabled: boolean;
  status: 'enabled' | 'requires-approval' | 'off' | 'unavailable';
}
