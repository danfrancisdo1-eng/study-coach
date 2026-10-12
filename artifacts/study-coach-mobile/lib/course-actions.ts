/**
 * The course screen's actions (D-058): what to say to the coach for each study action, and the
 * topics a student can pick from. Pure, so it is testable.
 */
export type StudyAction = 'practice' | 'exam' | 'flashcards' | 'hooks' | 'outline' | 'practiceNoMaterial';

export const ALL_TOPICS = 'All topics';

/** The message sent to the coach on the student's behalf. A null topic means the whole course. */
export function studyRequest(action: StudyAction, topic: string | null): string {
  const scope = topic && topic !== ALL_TOPICS ? topic : 'all topics';
  switch (action) {
    case 'practice': return `Give me a practice set on ${scope}`;
    case 'exam': return `Give me a simulated exam on ${scope}`;
    case 'flashcards': return `Flashcards on ${scope}`;
    case 'hooks': return `Give me memory tricks (hooks) for ${scope}`;
    case 'outline': return 'Show me the outline of topics for this course';
    case 'practiceNoMaterial': return `Give me a practice set on ${scope} from your own knowledge of this course; I have not uploaded material yet`;
  }
}

/** Per-phone flag: the "upload material first" note has been shown once (D-060). */
export const NO_MATERIAL_NOTE_KEY = 'study-coach-no-material-note-seen';

/** Topics to choose from: the exam guide's sections first, then topics already tested, no repeats (case-insensitive), then All. */
export function topicChoices(sections: readonly string[], tested: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...sections, ...tested]) {
    const topic = raw.trim().replace(/\s+/g, ' ');
    const key = topic.toLowerCase();
    if (!topic || seen.has(key) || key === ALL_TOPICS.toLowerCase()) continue;
    seen.add(key);
    out.push(topic);
  }
  return [...out, ALL_TOPICS];
}
