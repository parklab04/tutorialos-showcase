import type { LessonId } from '../lessons/types';

export interface AIConfig { apiKey: string; model: string }
export interface AIAnswer { lessonId: LessonId | null; explanation: string }
