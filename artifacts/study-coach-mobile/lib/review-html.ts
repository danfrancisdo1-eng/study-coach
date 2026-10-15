/**
 * The review sheet as a printable page (D-101; v2 layout D-106 after the AB-731 guide Dan got
 * from Grok): a title block with the exam's facts, "Skills at a glance", each domain with
 * sub-headings and bold terms, then the student's tricks, misses and the closing decoder, tips
 * and sources. expo-print turns it into the PDF. Every string is escaped: course material, web
 * pages and AI text are data, never markup.
 */
import type { ReviewSheet } from '@workspace/api-client-react';

export type ReviewSheetData = Pick<ReviewSheet, 'title' | 'subtitle' | 'courseName' | 'generatedAt' | 'facts' | 'audience' | 'glance' | 'priorityNote' | 'sections' | 'tips' | 'decoder' | 'sources'>;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function reviewHtml(sheet: ReviewSheetData): string {
  const e = escapeHtml;
  const d = new Date(sheet.generatedAt);
  const date = Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const facts = sheet.facts.length ? `<table class="facts">${sheet.facts.map((f) => `<tr><th>${e(f.label)}</th><td>${e(f.value)}</td></tr>`).join('')}</table>` : '';
  const glance = sheet.glance.length ? `
    <h2 class="band">Skills at a Glance</h2>
    <table class="glance"><thead><tr><th>Domain</th><th>Weight</th><th>Core focus</th></tr></thead><tbody>
      ${sheet.glance.map((g, i) => `<tr><td><b>${i + 1}. ${e(g.name)}</b></td><td class="w">${e(g.weight)}</td><td>${e(g.focus)}</td></tr>`).join('')}
    </tbody></table>
    ${sheet.priorityNote ? `<p class="note">${e(sheet.priorityNote)}</p>` : ''}` : '';
  const sections = sheet.sections.map((s, i) => `
    <section>
      <h2 class="band">Domain ${i + 1}: ${e(s.name)}${s.weight ? ` <span class="w">(${e(s.weight)})</span>` : ''}</h2>
      ${s.subsections.map((sub) => `
        ${sub.title ? `<h3>${e(sub.title)}</h3>` : ''}
        <ul>${sub.items.map((it) => `<li>${it.term ? `<b>${e(it.term)}:</b> ` : ''}${e(it.detail)}</li>`).join('')}</ul>`).join('')}
      ${s.contrasts.length || s.triggers.length || s.analogy ? `<div class="tricks"><h4>Remember it</h4>
        ${s.contrasts.map((c) => `<p><b>${e(c.pair)}:</b> ${e(c.trick)}</p>`).join('')}
        ${s.analogy ? `<p class="analogy">${e(s.analogy)}</p>` : ''}
        ${s.triggers.length ? `<table class="triggers"><tr><th>When you see…</th><th>Think</th></tr>${s.triggers.map((t) => `<tr><td>${e(t.whenYouSee)}</td><td><b>${e(t.think)}</b></td></tr>`).join('')}</table>` : ''}
      </div>` : ''}
      ${s.misses.length ? `<div class="misses"><h4>You missed these</h4>${s.misses.map((m) => `<p><span class="q">${e(m.question)}</span><br/><span class="a">Answer: ${e(m.answer)}</span>${m.giveaway ? `<br/><span class="g">The giveaway: ${e(m.giveaway)}</span>` : ''}</p>`).join('')}</div>` : ''}
    </section>`).join('');
  const tips = sheet.tips.length ? `<h2 class="band">Exam Tips &amp; Common Pitfalls</h2><ul>${sheet.tips.map((t) => `<li>${e(t)}</li>`).join('')}</ul>` : '';
  const decoder = sheet.decoder.length ? `<div class="decoder"><h4>Your decoder</h4><p>${sheet.decoder.map((x) => `<b>${e(x.cue)}</b> → ${e(x.answer)}`).join(' &nbsp;·&nbsp; ')}</p></div>` : '';
  const sources = sheet.sources.length ? `<div class="sources"><h4>Sources</h4>${sheet.sources.map((s) => `<p>${e(s.title)} — ${e(s.url)}</p>`).join('')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${e(sheet.title)}</title>
<style>
  @page { margin: 16mm 14mm; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1a1d24; font-size: 10.5pt; line-height: 1.42; margin: 0; }
  .running { color: #6b7280; font-size: 8.5pt; border-bottom: 1px solid #d9dde3; padding-bottom: 4px; margin-bottom: 14px; }
  h1 { font-size: 21pt; line-height: 1.15; margin: 0 0 4px; color: #0b2a4a; }
  .subtitle { color: #374151; font-size: 11pt; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; }
  .facts th { text-align: left; width: 28%; background: #f3f5f8; color: #374151; font-weight: 600; }
  .facts th, .facts td, .glance th, .glance td, .triggers th, .triggers td { border: 1px solid #d9dde3; padding: 5px 8px; vertical-align: top; font-size: 9.5pt; }
  .glance thead th, .triggers th { background: #0b2a4a; color: #fff; text-align: left; font-weight: 600; }
  .glance .w, .w { white-space: nowrap; color: #0b6b4f; font-weight: 600; }
  .audience { font-size: 9.5pt; color: #374151; margin: 6px 0 10px; }
  .note { font-size: 9.5pt; background: #eef6ff; border-left: 3px solid #2f6fd6; padding: 6px 10px; margin: 4px 0 10px; }
  h2.band { font-size: 13pt; color: #0b2a4a; border-bottom: 2px solid #0b2a4a; padding-bottom: 3px; margin: 18px 0 8px; }
  h3 { font-size: 11pt; color: #1f3b63; margin: 10px 0 4px; }
  h4 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 0 0 4px; }
  ul { margin: 0 0 6px; padding-left: 16px; } li { margin: 3px 0; }
  .tricks { background: #fff8e8; border: 1px solid #f0dca8; border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
  .tricks p { margin: 3px 0; } .analogy { font-style: italic; }
  .misses { border-left: 3px solid #d64550; padding-left: 10px; margin: 8px 0; }
  .misses p { margin: 5px 0; } .q { font-weight: 600; } .a { color: #0b6b4f; } .g { color: #6b7280; font-size: 9pt; }
  .decoder { background: #0b2a4a; color: #fff; border-radius: 6px; padding: 10px 12px; margin: 14px 0; }
  .decoder h4 { color: #c7d2e0; } .decoder p { margin: 0; line-height: 1.7; }
  .sources p { font-size: 8.5pt; color: #4b5563; margin: 2px 0; word-break: break-all; }
  section { break-inside: auto; } h2, h3, h4 { break-after: avoid; } tr, li { break-inside: avoid; }
  footer { margin-top: 16px; color: #9ca3af; font-size: 8pt; border-top: 1px solid #e5e7eb; padding-top: 6px; }
</style></head><body>
<div class="running">${e(sheet.title)}${date ? ` • ${date}` : ''}</div>
<h1>${e(sheet.title)}</h1>
${sheet.subtitle ? `<p class="subtitle">${e(sheet.subtitle)}</p>` : ''}
${facts}
${sheet.audience ? `<p class="audience"><b>Audience:</b> ${e(sheet.audience)}</p>` : ''}
${glance}
${sections}
${tips}
${decoder}
${sources}
<footer>Made with RapidRecall AI for ${e(sheet.courseName)} from the official exam outline, your material and your results. Check the official exam page for the latest details.</footer>
</body></html>`;
}
