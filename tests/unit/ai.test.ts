import test from 'node:test';
import assert from 'node:assert/strict';
import { configureAI, askAI, isAIConfigured } from '../../electron/features/ai/ai';

test('AI requires explicit connection and disconnect clears it', async () => {
  configureAI({ apiKey: '', model: '' });
  assert.equal(isAIConfigured(), false);
  await assert.rejects(askAI('글자를 키우고 싶어요'), /Connect AI in Settings first/);
  configureAI({ apiKey: 'test-key-not-a-secret', model: '' });
  assert.equal(isAIConfigured(), true);
  configureAI({ apiKey: '', model: '' });
  assert.equal(isAIConfigured(), false);
});
test('API response cannot return executable actions or unsupported lesson IDs', async () => {
  const originalFetch = globalThis.fetch;
  configureAI({ apiKey: 'test-key-not-a-secret', model: '' });
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ lessonId: 'run-shell', explanation: 'x' }) }] }), { status: 200 });
  try { await assert.rejects(askAI('도와주세요'), /unexpected format/); }
  finally { globalThis.fetch = originalFetch; configureAI({apiKey:'',model:''}); }
});
test('only question and curated lessons leave app; successful recommendation is typed', async () => {
  const originalFetch = globalThis.fetch;
  configureAI({ apiKey: 'test-key-not-a-secret', model: '' });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const request = JSON.parse(String(init?.body));
    assert.equal(request.messages[0].content, '글자 확대');
    assert.equal(request.tools, undefined);
    assert.equal(String(init?.body).includes('screenshot'), false);
    return new Response(JSON.stringify({ content: [{type:'text',text:JSON.stringify({ lessonId:'safari-zoom',explanation:'Learn how to make text larger in Safari.'})}],stop_reason:'end_turn'}), {status:200});
  };
  try { assert.equal((await askAI('글자 확대')).lessonId, 'safari-zoom'); }
  finally { globalThis.fetch = originalFetch; configureAI({apiKey:'',model:''}); }
});
