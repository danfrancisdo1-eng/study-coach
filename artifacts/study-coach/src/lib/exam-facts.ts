// Same as the phone (study-coach-mobile/lib/exam-facts.ts); keep the two in step.
/** The real exam's facts as one line (spec B, D-110): "Real exam: 50 questions · 100 minutes · pass 700 out of 1000"; "" when nothing is known. */
export function realExamLine(guide: { questionCount?: unknown; durationMinutes?: unknown; passingScore?: unknown } | null | undefined): string {
  if (!guide) return '';
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const q = n(guide.questionCount);
  const m = n(guide.durationMinutes);
  const pass = typeof guide.passingScore === 'string' ? guide.passingScore.trim() : '';
  const parts = [q ? `${q} question${q === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : '', pass ? `pass ${pass}` : ''].filter(Boolean);
  return parts.length ? `Real exam: ${parts.join(' · ')}` : '';
}
