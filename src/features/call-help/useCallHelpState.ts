import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallHelpState } from './contracts';

export function useCallHelpState() {
  const [state, setState] = useState<CallHelpState | null>(null);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const pendingWrites = useRef(0);
  const refresh = useCallback(async () => {
    if (!mounted.current || pendingWrites.current > 0) return;
    const bridge = window.helpOS;
    const current = ++revision.current;
    try {
      if (!bridge?.getCallHelpState) throw new Error('Automatic help unavailable');
      const value = await bridge.getCallHelpState();
      if (mounted.current && revision.current === current) { setState(value); setError(false); }
    } catch { if (mounted.current && revision.current === current) setError(true); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const bridge = window.helpOS;
    if (!bridge?.getCallHelpState || !bridge.onCallHelpState) { setError(true); return () => { mounted.current = false; }; }
    const off = bridge.onCallHelpState(value => { revision.current++; if (mounted.current) { setState(value); setError(false); } });
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    void refresh();
    return () => { mounted.current = false; revision.current++; window.removeEventListener('focus', focus); off(); };
  }, [refresh]);
  const apply = useCallback(async (operation: () => Promise<CallHelpState>) => {
    // A write invalidates earlier reads; focus cannot start a competing read.
    const current = ++revision.current;
    pendingWrites.current++;
    try {
      const value = await operation();
      if (mounted.current && revision.current === current) { setState(value); setError(false); }
    } finally { pendingWrites.current--; }
  }, []);
  return { state, error, apply, refresh };
}
