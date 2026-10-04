import type { LessonId, Verification } from '../lessons/types';
import { lessons } from '../lessons/catalog';

export interface PracticeSession {
  lessonId: LessonId;
  stepIndex: number;
  complete: boolean;
  hints: boolean;
  helpRequests: number;
  verification: Verification;
  actions: string[];
}
export function createSession(lessonId: LessonId, hints = true): PracticeSession {
  if (!lessons.some(lesson => lesson.id === lessonId)) throw new Error('Unknown lesson');
  return { lessonId, stepIndex: 0, complete: false, hints, helpRequests: 0, verification: null, actions: [] };
}
export function advanceSession(state: PracticeSession, action: string): PracticeSession {
  if (state.complete) return state;
  const lesson = lessons.find(item => item.id === state.lessonId)!;
  if (lesson.steps[state.stepIndex]?.action !== action) return state;
  const next = state.stepIndex + 1;
  return { ...state, stepIndex: next, complete: next === lesson.steps.length, actions: [...state.actions, action], verification: next === lesson.steps.length ? 'practice-event' : null };
}
export function requestHint(state: PracticeSession): PracticeSession {
  return { ...state, hints: true, helpRequests: state.helpRequests + 1 };
}
