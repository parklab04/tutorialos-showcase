import { useState } from 'react';
import { copy } from '../../shared/copy';
import type { AIAnswer } from './contracts';

export function useAIAdvice(setError: (message: string) => void) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AIAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    if (!window.helpOS || !question.trim() || asking) return;
    setAsking(true); setAnswer(null); setError('');
    try { setAnswer(await window.helpOS.askAI(question.trim())); } catch { setError(copy.ai.error); } finally { setAsking(false); }
  };
  return { question, setQuestion, answer, asking, ask, clearAnswer: () => setAnswer(null) };
}

export type AIAdviceController = ReturnType<typeof useAIAdvice>;
