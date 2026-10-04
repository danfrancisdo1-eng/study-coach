/**
 * Deleting a course is confirmed by typing the first word of its name
 * (case and surrounding spaces ignored). The web app applies the same rule.
 */
export function courseConfirmWord(courseName: string): string {
  return courseName.trim().split(/\s+/)[0] ?? '';
}

export function matchesCourseConfirmWord(typed: string, courseName: string): boolean {
  const word = courseConfirmWord(courseName);
  return word !== '' && typed.trim().toLowerCase() === word.toLowerCase();
}
