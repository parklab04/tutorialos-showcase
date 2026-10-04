import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, FolderOpen } from 'lucide-react';
import { copy } from '../../shared/copy';
import type { PermissionKind, PermissionRequestResult } from './contracts';

type SetupResult = PermissionRequestResult & { kind: PermissionKind };

export function PermissionSetup({ accessibility, screenCapture, allowScreen = true, compact = false, onRefresh, onStart }: {
  accessibility: boolean; screenCapture: boolean; allowScreen?: boolean; compact?: boolean;
  onRefresh?: () => Promise<void>; onStart?: () => void;
}) {
  const [pending, setPending] = useState<PermissionKind | null>(null);
  const pendingRequest = useRef(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    // A later observed permission change supersedes the previous request result.
    setResult(previous => previous && previous.granted !== (previous.kind === 'accessibility' ? accessibility : screenCapture) ? null : previous);
  }, [accessibility, screenCapture]);
  const request = async (kind: PermissionKind) => {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    setPending(kind); setResult(null); setError(''); onStart?.();
    try {
      if (!window.helpOS) throw new Error('Desktop bridge unavailable');
      setResult({ ...await window.helpOS.requestPermission(kind), kind });
      await onRefresh?.();
    } catch { setError(copy.permissions.setupError); }
    finally { pendingRequest.current = false; setPending(null); }
  };
  const showApp = async () => {
    setError('');
    try {
      if (!window.helpOS) throw new Error('Desktop bridge unavailable');
      await window.helpOS.showAppInFinder();
    } catch { setError(copy.permissions.showAppError); }
  };
  // A late denied request must not contradict a newer observed grant.
  const notice = result && !result.granted && (result.kind === 'accessibility' ? accessibility : screenCapture) ? null : result;
  const kinds: PermissionKind[] = allowScreen ? ['accessibility', 'screen'] : ['accessibility'];
  return <div className="permission-setup" aria-busy={!!pending}>
    {!compact && <p>{copy.permissions.accessibilityIntro}</p>}
    {kinds.map(kind => {
      const allowed = (kind === 'accessibility' ? accessibility : screenCapture) || (!onRefresh && result?.kind === kind && result.granted);
      const title = kind === 'accessibility' ? copy.permissions.accessibilityTitle : copy.permissions.screenTitle;
      const label = kind === 'accessibility' ? copy.permissions.setupAccessibility : copy.permissions.setupScreen;
      return <div key={kind} className="permission-row" data-permission={kind} style={{ flexDirection: 'column' }}>
        {!compact && <div><strong>{title}</strong>{kind === 'screen' && <p className="settings-note">{copy.permissions.screenAlternative}</p>}<p>{kind === 'accessibility' ? copy.permissions.accessibilityDescription : copy.permissions.screenDescription}</p></div>}
        {compact && kind === 'screen' && <p className="settings-note">{copy.permissions.screenAlternative}</p>}
        {allowed ? <span className="permission-state"><Check size={18} />{copy.permissions.enabled}</span> : <button className="button secondary" disabled={!!pending} onClick={() => void request(kind)} style={{ whiteSpace: 'normal' }}>{pending === kind ? copy.permissions.requesting : label}<ExternalLink size={17} /></button>}
      </div>;
    })}
    {pending && <p className="notice" role="status">{copy.permissions.pending}</p>}
    {!pending && notice && <div role="status" aria-live="polite"><p className="notice">{notice.granted ? copy.permissions.available : notice.settingsOpened ? copy.permissions.settingsOpened : copy.permissions.notGranted}</p>{!notice.granted && notice.settingsOpened && <><p>{copy.permissions.enableApp}</p><p>{copy.permissions.reopen}</p><button className="button secondary" onClick={() => void showApp()}><FolderOpen size={18} />{copy.permissions.showApp}</button></>}</div>}
    {error && <p className="notice" role="alert">{error}</p>}
  </div>;
}
