import { ArrowRight, KeyRound } from 'lucide-react';
import { copy } from '../../shared/copy';
import { lessons } from '../lessons/catalog';
import type { Lesson } from '../lessons/types';
import type { AIAdviceController } from './useAIAdvice';

export function AIAdvice({ controller, mode, onStart }: {
  controller: AIAdviceController;
  mode: 'practice' | 'live';
  onStart: (lesson: Lesson) => void;
}) {
  const { question, setQuestion, answer, asking, ask } = controller;
  return <section className="ai-advice"><div className="group-heading"><KeyRound size={23} /><div><h2>{copy.ai.title}</h2><p>{copy.ai.description}</p></div></div><form onSubmit={event => { event.preventDefault(); void ask(); }}><label className="sr-only" htmlFor="ai-question">What you want to learn</label><input id="ai-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder={copy.ai.placeholder} maxLength={1000} /><button className="button primary" type="submit" disabled={asking || !question.trim()}>{asking ? copy.ai.thinking : copy.ai.ask}<ArrowRight size={18} /></button></form><p className="settings-note">{copy.ai.privacy}</p>{answer && <div className="ai-answer"><p>{answer.explanation}</p>{answer.lessonId && <button className="button secondary" onClick={() => { const found = lessons.find(item => item.id === answer.lessonId); if (found) void onStart(found); }}>{mode === 'practice' ? copy.lesson.startPractice : copy.lesson.startLive}<ArrowRight size={18} /></button>}</div>}</section>;
}
