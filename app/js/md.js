// The grammar notes use a tiny subset of Markdown: "## " headings, "- " lists,
// paragraphs and **bold**. Everything is escaped first, so content can never
// inject markup.

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function inline(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function renderNotes(markdown) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push('<ul>' + list.map((li) => `<li>${li}</li>`).join('') + '</ul>'); list = null; } };
  for (const raw of String(markdown).split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); out.push(`<h2>${inline(line.slice(3))}</h2>`); }
    else if (line.startsWith('- ')) { (list = list || []).push(inline(line.slice(2))); }
    else { flush(); out.push(`<p>${inline(line)}</p>`); }
  }
  flush();
  return out.join('\n');
}
