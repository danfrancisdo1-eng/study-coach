/**
 * The Add sheet on the Courses tab opens on request (D-181). Since the tab bar (D-164) the
 * Courses screen stays mounted, so a request (`?add=1`) has to be read every time the param
 * changes, not only when the screen first draws; once read it is cleared so the same request
 * from another button opens the sheet again. Before this, "Add a course" on the course page,
 * the coach's "Add a course or exam" chip, and the welcome's button after the first visit only
 * switched to the list.
 */
export const ADD_PARAM_CLEARED = '';

export function wantsAddSheet(add: string | string[] | undefined): boolean {
  return (Array.isArray(add) ? add[0] : add) === '1';
}
