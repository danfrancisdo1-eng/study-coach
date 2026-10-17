// A set's topic for headers (D-130, Dan: "Not readable, each section title should have its own
// line"). "All topics: a; b; c" (coach.v22 joins with "; " so names with commas survive; older
// sets used ", ") becomes the title "All topics" and one section per line.
export function topicParts(topic: string): { title: string; sections: string[] } {
  const m = /^all topics\s*:\s*(.+)$/i.exec(topic.trim());
  if (!m) return { title: topic.trim(), sections: [] };
  const list = m[1]!;
  const sections = (list.includes(';') ? list.split(';') : list.split(',')).map((s) => s.trim()).filter(Boolean);
  return { title: 'All topics', sections };
}
