// Which course the chat's + button should open the material sheet on:
// the course the coach most recently created or started a session for, else the
// only course, else the first one. Null when the student has no courses yet.
export type IntakeCourse = { id: string; name: string };
type ActionLike = { type: string; courseId: string };
type MessageLike = { actions?: ActionLike[] };

export function defaultIntakeCourse(courses: IntakeCourse[], messages: MessageLike[]): IntakeCourse | null {
  if (!courses.length) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const actions = messages[i]?.actions ?? [];
    for (let j = actions.length - 1; j >= 0; j -= 1) {
      const match = courses.find((course) => course.id === actions[j]?.courseId);
      if (match) return match;
    }
  }
  return courses[0] ?? null;
}
