import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { copy } from '../../shared/copy';
import type { AppStatus } from '../../shared/bridge';

export function AISettings({ status, refresh }: { status: AppStatus; refresh: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const configure = async (remove = false) => {
    if (!window.helpOS) return;
    setBusy(true); setMessage('');
    try { await window.helpOS.configureAI({ apiKey: remove ? '' : apiKey, model }); await refresh(); setMessage(remove ? 'AI disconnected.' : copy.settings.saved); }
    catch { setMessage('Check the API key and model name, then try again.'); }
    finally { setApiKey(''); setBusy(false); }
  };
  return <>
      <section className="settings-section"><h3><KeyRound size={21} />{copy.settings.aiTitle}</h3><p>{copy.ai.description}</p><p className="settings-note">{copy.settings.sessionOnly}</p>{status.desktop ? <form onSubmit={event => { event.preventDefault(); void configure(); }}><label>{copy.settings.apiKey}<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={status.aiConfigured ? 'Enter a new API key' : 'Enter API key'} maxLength={500} /></label><label>{copy.settings.model}<input value={model} onChange={event => setModel(event.target.value)} spellCheck={false} maxLength={100} /></label><div className="settings-actions"><button type="submit" className="button primary" disabled={busy || !apiKey.trim()}>{busy ? 'Applying…' : copy.settings.save}</button>{status.aiConfigured && <button type="button" className="button secondary" disabled={busy} onClick={() => void configure(true)}>{copy.settings.remove}</button>}</div></form> : <p>{copy.error.desktopOnlyDescription}</p>}</section>
      {message && <p className="notice" role="status">{message}</p>}
  </>;
}
