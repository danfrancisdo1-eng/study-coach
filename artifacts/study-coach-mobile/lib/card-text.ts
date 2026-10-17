// Flashcard backs as separate lines, one idea each (D-130, Dan: "more separation between topics").
// New cards are written with line breaks (flashcards.v3); an older run-on back with several
// "Term: …" sentences is split at its sentences.
export function cardLines(text: string): string[] {
  const written = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (written.length !== 1) return written;
  const one = written[0]!;
  if (!/[.!?]\s+[A-Z][^.:!?]{1,40}:\s/.test(one)) return written;
  return one.split(/(?<=[.!?])\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);
}
