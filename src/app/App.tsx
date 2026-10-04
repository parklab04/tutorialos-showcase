import { CallSuggestion } from '../features/call-help/CallSuggestion';
import { LiveWindow } from '../features/live-guide/LiveWindows';
import { useTextScale } from '../shared/hooks/useTextScale';
import { Home } from './Home';
import { VoicePanel } from '../features/voice-guide/VoicePanel';

export default function App() {
  const { scale, setScale } = useTextScale();
  if (window.location.hash === '#overlay') return <LiveWindow overlay />;
  if (window.location.hash === '#call-help') return <CallSuggestion scale={scale} />;
  if (window.location.hash === '#coach') return <LiveWindow overlay={false} />;
  if (window.location.hash === '#voice') return <VoicePanel />;
  return <Home scale={scale} setScale={setScale} />;
}
