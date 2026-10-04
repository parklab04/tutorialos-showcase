import { useEffect, useState } from 'react';

export function useTextScale() {
  const read = () => { try { const value = Number(localStorage.getItem('helpos:text-scale') || 1); return [1, 1.25, 1.5, 2].includes(value) ? value : 1; } catch { return 1; } };
  const [scale, setScaleValue] = useState(read);
  useEffect(() => { document.documentElement.style.setProperty('--text-scale', String(scale)); document.documentElement.classList.toggle('enlarged-text', scale > 1); }, [scale]);
  useEffect(() => { const listener = () => setScaleValue(read()); window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener); }, []);
  const setScale = (value: number) => { setScaleValue(value); try { localStorage.setItem('helpos:text-scale', String(value)); } catch { /* Preference remains usable for this window. */ } };
  return { scale, setScale };
}
