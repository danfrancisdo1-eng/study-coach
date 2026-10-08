// Option order (D-032): the writer puts the key in slot A or B most of the time (audit of
// 200 questions: A 78, B 68, C 46, D 8), so the options are shuffled after the answer-key
// check and the key follows its option. Pure; no AI import, so unit tests load it directly.
import type { ProposedQuestion } from "./quiz-check";

/** Options whose wording depends on position: "All of the above", "None of the above", "B and C", "Both A and D". */
const ABOVE = /\b(all|none|both|neither|any|each)\s+of\s+(the|these)\s+above\b/i;
const LETTERS = /\b[A-E](\s*(,|and|or|&)\s*[A-E])+\b/; // capitals only: "a and b" in prose is not a reference

export function hasPositionalOption(options: string[]): boolean {
  return options.some((text) => ABOVE.test(text) || LETTERS.test(text));
}

/** Returns the question with its options in a random order and answerIndex moved with the key; untouched when an option refers to other options by position. */
export function shuffleOptions<Q extends Pick<ProposedQuestion, "options" | "answerIndex">>(question: Q, random: () => number = Math.random): Q {
  if (hasPositionalOption(question.options)) return question;
  const order = question.options.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { ...question, options: order.map((index) => question.options[index]!), answerIndex: order.indexOf(question.answerIndex) };
}
