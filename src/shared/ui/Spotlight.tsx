import { useId } from 'react';
import type { Rect } from '../geometry';
import { spotlightPadding } from './spotlight-layout';

export function Spotlight({ target, native = false }: { target: Rect; native?: boolean }) {
  const mask = `spotlight-${useId().replace(/:/g, '')}`;
  const hole = { x: target.x - spotlightPadding, y: target.y - spotlightPadding, width: target.width + spotlightPadding * 2, height: target.height + spotlightPadding * 2 };
  return <>
    <svg className="tutorial-scrim" aria-hidden="true" width="100%" height="100%">
      <defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><rect width="100%" height="100%" fill="white" /><rect data-spotlight-hole="target" {...hole} rx="13" fill="black" /></mask></defs>
      <rect width="100%" height="100%" fill="rgba(24, 28, 31, 0.58)" mask={`url(#${mask})`} />
    </svg>
    <div className={native ? 'native-target' : 'practice-highlight'} aria-hidden="true" style={{ left: hole.x, top: hole.y, width: hole.width, height: hole.height }} />
  </>;
}
