export const lessonIds = ['facetime-mic', 'facetime-camera', 'facetime-end', 'safari-zoom', 'safari-reader', 'safari-bookmark', 'safari-reopen-tab', 'finder-downloads'] as const;
export type LessonId = typeof lessonIds[number];
export type AppId = 'facetime' | 'safari' | 'finder';
export type Verification = 'practice-event' | 'observed' | 'self-confirmed' | null;
export interface Lesson {
  id: LessonId; app: AppId; title: string; description: string; duration: string;
  outcome: string; prerequisite: string; steps: LessonStep[];
  requiresAccessibility?: boolean;
  confirmation?: { title: string; label: string };
}
export interface LessonStep {
  id: string; title: string; instruction: string; why: string; target: string;
  targetAliases: string[]; action: string;
  keyboardShortcuts?: Array<{ label: string; keys: string[] }>;
}
