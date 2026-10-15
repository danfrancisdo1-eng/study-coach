// Each course is a Project (D-119, part A D-121): every upload belongs to one course. Pure, so
// tests load it directly.
type O = Record<string, unknown>;
const isObject = (v: unknown): v is O => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * The names of uploads a save would add without a course that exists. Uploads already saved
 * before (by id) are left alone, so older accounts with a loose upload can still save.
 */
export function newUploadsWithoutCourse(before: O | null | undefined, after: O): string[] {
  const courseIds = new Set(list(after.courses).flatMap((c) => (isObject(c) && typeof c.id === "string" ? [c.id] : [])));
  const known = new Set(list(before?.materials).flatMap((m) => (isObject(m) && typeof m.id === "string" ? [m.id] : [])));
  return list(after.materials).flatMap((m) => {
    if (!isObject(m)) return [];
    if (typeof m.id === "string" && known.has(m.id)) return [];
    if (typeof m.courseId === "string" && courseIds.has(m.courseId)) return [];
    return [typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 80) : "an upload"];
  });
}
