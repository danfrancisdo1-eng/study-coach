/**
 * Where a signed-in account lands (D-056, Dan): an account with a course or exam opens on the
 * course list; an account with none opens on the coach screen, where the welcome is.
 */
export type HomeRoute = '/course-list' | '/(tabs)';

export function homeRoute(state: unknown): HomeRoute {
  const courses = state && typeof state === 'object' ? (state as { courses?: unknown }).courses : undefined;
  return Array.isArray(courses) && courses.length > 0 ? '/course-list' : '/(tabs)';
}
