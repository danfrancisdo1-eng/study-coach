/**
 * The one line a tester can read off the crash screen (D-180): the error's own message, cut to
 * a sentence, with the name of the first app file in the stack when there is one. Store builds
 * hide the full stack; this is enough to tell "sign-out" from "paywall" from "video".
 */
export function crashLine(error: { message?: unknown; stack?: unknown } | null | undefined, max = 160): string {
  const message = typeof error?.message === 'string' ? error.message.replace(/\s+/g, ' ').trim() : '';
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  // The first frame that names one of the app's own files (app/… or components/…), without the bundle noise.
  const frame = /\b(?:app|components|hooks|lib)\/[\w\-[\]()./]+?\.tsx?\b/.exec(stack)?.[0] ?? '';
  const head = message || 'Unknown error';
  const line = frame ? `${head} (${frame})` : head;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
