import { useEffect, useState } from 'react';
import type { LiveState } from './contracts';

export function useLiveState() {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!window.helpOS) return;
    let active = true;
    let received = false;
    const off = window.helpOS.onLiveState(value => { received = true; if (active) { setState(value); setError(false); } });
    void window.helpOS.getLiveState().then(value => { if (active && !received) setState(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; off(); };
  }, []);
  return { state, error, setState };
}
