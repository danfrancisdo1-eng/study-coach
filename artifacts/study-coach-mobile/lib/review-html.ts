/**
 * The review sheet as a printable page (D-101, spec C): what expo-print turns into the PDF.
 * Every piece of text is escaped: course material and AI text are data, never markup.
 */
export type ReviewSheetData = {
  title: string;
  courseName: string;
  generatedAt: string;
  sections: { name: string; points: string[]; tricks: string[]; misses: { question: string; answer: string }[] }[];
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function reviewHtml(sheet: ReviewSheetData): string {
  const d = new Date(sheet.generatedAt);
  const date = Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const e = escapeHtml;
  const sections = sheet.sections.map((s, i) => `
    <section>
      <h2>${i + 1}. ${e(s.name)}</h2>
      <ul>${s.points.map((p) => `<li>${e(p)}</li>`).join('')}</ul>
      ${s.tricks.length ? `<div class="tricks"><h3>Remember it</h3>${s.tricks.map((t) => `<p>⚡ ${e(t)}</p>`).join('')}</div>` : ''}
      ${s.misses.length ? `<div class="misses"><h3>You missed these</h3>${s.misses.map((m) => `<p><span class="q">${e(m.question)}</span><br/><span class="a">Answer: ${e(m.answer)}</span></p>`).join('')}</div>` : ''}
    </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${e(sheet.title)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1d24; margin: 36px; font-size: 12.5px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: #6b7280; margin: 0 0 18px; }
  h2 { font-size: 15px; margin: 18px 0 6px; padding-top: 6px; border-top: 1px solid #e5e7eb; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 8px 0 4px; }
  ul { margin: 0; padding-left: 18px; } li { margin: 2px 0; }
  .tricks { background: #fff7e6; border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
  .tricks p { margin: 3px 0; }
  .misses { border-left: 3px solid #e5566b; padding-left: 10px; margin-top: 8px; }
  .misses p { margin: 4px 0; } .q { font-weight: 600; } .a { color: #1f7a4d; }
  section { break-inside: avoid-page; }
  footer { margin-top: 24px; color: #9ca3af; font-size: 10px; }
</style></head><body>
<h1>${e(sheet.title)}</h1>
<p class="sub">${e(sheet.courseName)}${date ? ` · ${date}` : ''}</p>
${sections}
<footer>Made with RapidRecall AI from your own material and results. Points marked "(General knowledge)" are not from your material.</footer>
</body></html>`;
}
