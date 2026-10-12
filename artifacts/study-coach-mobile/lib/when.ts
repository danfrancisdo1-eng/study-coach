/** "Oct 11, 2:14 pm" in the phone's time zone (review finding 19, D-077): sets on the same day stay distinguishable. */
export function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  const hours = date.getHours();
  const h = hours % 12 === 0 ? 12 : hours % 12;
  return `${month} ${date.getDate()}, ${h}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}
