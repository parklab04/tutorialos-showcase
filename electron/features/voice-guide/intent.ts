import type { VoiceGoal, VoiceGoalId } from '../../../src/features/voice-guide/contracts';

const goals: Record<VoiceGoalId, VoiceGoal> = {
  mute: { id: 'mute', app: 'facetime', label: 'Mute my microphone' },
  unmute: { id: 'unmute', app: 'facetime', label: 'Turn my microphone on' },
  'camera-off': { id: 'camera-off', app: 'facetime', label: 'Turn my camera off' },
  'camera-on': { id: 'camera-on', app: 'facetime', label: 'Turn my camera on' },
  'zoom-in': { id: 'zoom-in', app: 'safari', label: 'Make this page larger' },
};
export const voiceGoal = (id: VoiceGoalId): VoiceGoal => ({ ...goals[id] });

export function parseVoiceGoal(input: string): { goal: VoiceGoal | null; message: string } {
  const text = input.toLowerCase().normalize('NFKC').replace(/[’‘]/g, "'").replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\bun[ -]+mute\b/g, 'unmute');
  const reject = (message: string) => ({ goal: null, message });
  if (!text) return reject('Say or type what you want help with.');
  // Deliberately bounded demo grammar. Do not guess through negation, an
  // unsupported app, or a compound request. The reviewed transcript is editable.
  if (/\b(don't|do not|never|not|stop listening|cancel|instead|then|after|before|and|or)\b/.test(text)) return reject('Try one clear request, such as “Mute my microphone”.');
  if (/\b(zoom call|zoom meeting|teams|google meet|chrome|whatsapp|discord)\b/.test(text)) return reject('This demo guides FaceTime controls and Safari page zoom.');
  if (/\b(speaker|speakers|headphones|volume|music|television|tv|message|messages|call someone|end the call|hang up)\b/.test(text)) return reject('This demo guides your FaceTime microphone or camera, and Safari page zoom.');
  const mic = /\b(microphone|mic|mike)\b/.test(text);
  const camera = /\b(camera|video)\b/.test(text);
  const off = /\b(off|disable)\b/.test(text) || /\b(stop|disable)\b.*\b(camera|video)\b/.test(text);
  const on = /\b(on|enable)\b/.test(text) || /\b(start|enable)\b.*\b(camera|video)\b/.test(text);
  const wantsMute = /\bmute\b/.test(text) || (mic && off);
  const wantsUnmute = /\bunmute\b/.test(text) || (mic && on);
  const wantsZoom = /\bzoom (?:it |the page )?in\b/.test(text) || (/\b(text|page|words|font|writing)\b/.test(text) && /\b(bigger|larger|enlarge|increase)\b/.test(text));
  const candidates: VoiceGoalId[] = [];
  if (wantsMute && !camera) candidates.push('mute');
  if (wantsUnmute && !camera) candidates.push('unmute');
  if (camera && off && !mic && !/\b(mute|unmute)\b/.test(text)) candidates.push('camera-off');
  if (camera && on && !mic && !/\b(mute|unmute)\b/.test(text)) candidates.push('camera-on');
  if (wantsZoom) candidates.push('zoom-in');
  if (candidates.length !== 1 || (mic && camera) || (wantsZoom && (mic || camera))) return reject('Try “Mute my microphone”, “Turn my microphone on”, or “Make the page larger”.');
  const goal = voiceGoal(candidates[0]);
  if ((goal.app === 'facetime' && /\bsafari\b/.test(text)) || (goal.app === 'safari' && /\bface ?time\b/.test(text))) return reject('Use FaceTime for microphone or camera help, and Safari for page zoom.');
  return { goal, message: 'Check your request, then choose Show me.' };
}
