// D-139: the review sheet opens in its own tab with a "Print or save as PDF" bar (the bar never prints by
// itself). The tab is opened in the click itself (pop-up blockers), then filled when the sheet is written.
// Shared by the Coach chat's chip and the course screen's button (D-305).
import type { ReviewSheet } from '@workspace/api-client-react';
import { reviewHtml } from '@phone-lib/review-html';

const withPrintBar = (html: string) => html.replace(/<body([^>]*)>/, '<body$1><div class="rr-print-bar" style="position:sticky;top:0;display:flex;justify-content:flex-end;padding:10px;background:#fff;border-bottom:1px solid #ddd"><button type="button" onclick="window.print()" style="font:600 15px system-ui;padding:10px 16px;border-radius:10px;border:0;background:#F2B544;cursor:pointer">Print or save as PDF</button></div><style>@media print{.rr-print-bar{display:none!important}}</style>');

/** Opens the tab now and writes the sheet into it once `make` resolves; a failure closes the tab and calls `onError`. */
export function openReviewTab(make: () => Promise<ReviewSheet>, onError: (problem: unknown) => void): void {
  const tab = window.open('', '_blank');
  if (!tab) { onError({ data: { error: 'Allow pop-ups for this site to open the review sheet.' } }); return; }
  tab.document.write('<p style="font-family:sans-serif;padding:24px">Writing your review sheet…</p>');
  make().then((sheet) => {
    tab.document.open(); tab.document.write(withPrintBar(reviewHtml(sheet))); tab.document.close(); tab.focus();
  }, (problem) => { tab.close(); onError(problem); });
}
