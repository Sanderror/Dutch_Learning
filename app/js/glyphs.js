// Line drawings for the tiles and the interface icons. All original, drawn on
// a 48 x 48 grid and stroked in the current text colour.

const wrap = (body) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// A finished lesson is painted with one of these.
const MOTIFS = [
  // tulip
  '<path d="M24 44V27"/><path d="M24 38c-6 0-9-4-9-8 5 0 9 3 9 8z"/><path d="M24 36c6 0 9-4 9-8-5 0-9 3-9 8z"/><path d="M16 9c0 10 3 17 8 17s8-7 8-17l-4 5-4-7-4 7z"/>',
  // windmill
  '<path d="M18 44l3-19h6l3 19z"/><path d="M24 21L11 8M24 21L37 8M24 21L10 31M24 21l14 10"/><circle cx="24" cy="21" r="2.2"/>',
  // sailing boat
  '<path d="M7 32h34l-5 9H12z"/><path d="M24 32V7"/><path d="M24 9l13 19H24z"/><path d="M24 15L13 28h11"/>',
  // bird
  '<path d="M7 29c6-11 17-13 25-6l9-4-4 9c0 8-9 12-17 10-6-1-11-4-13-9z"/><path d="M19 27c5 0 8 2 9 6"/><circle cx="32" cy="24" r="0.9"/>',
  // fish
  '<path d="M5 24c7-10 19-12 29 0-10 12-22 10-29 0z"/><path d="M34 24l9-8v16z"/><circle cx="14" cy="22" r="0.9"/><path d="M21 19c2 3 2 7 0 10"/>',
  // canal house
  '<path d="M11 44V23h4v-5h4v-5h10v5h4v5h4v21z"/><path d="M21 44v-9h6v9"/><path d="M17 26h4v4h-4zM27 26h4v4h-4z"/>',
  // flower
  '<circle cx="24" cy="19" r="3"/><circle cx="24" cy="10" r="4"/><circle cx="32.5" cy="16" r="4"/><circle cx="29.3" cy="26" r="4"/><circle cx="18.7" cy="26" r="4"/><circle cx="15.5" cy="16" r="4"/><path d="M24 31v13"/>',
  // sun
  '<circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/>',
];

export function motif(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return wrap(MOTIFS[h % MOTIFS.length]);
}

export const ICON = {
  dialogue: wrap('<path d="M6 10h24v15H16l-6 6v-6H6z"/><path d="M34 19h8v14h-4v6l-6-6h-10"/>'),
  skip: wrap('<path d="M12 12l12 12-12 12M26 12l12 12-12 12"/>'),
  speaker: wrap('<path d="M7 19h8l10-8v26l-10-8H7z"/><path d="M32 17c3 4 3 10 0 14M37 12c6 7 6 17 0 24"/>'),
  close: wrap('<path d="M12 12l24 24M36 12L12 36"/>'),
  back: wrap('<path d="M28 10L14 24l14 14"/>'),
  settings: wrap('<path d="M7 14h34M7 24h34M7 34h34"/><circle cx="17" cy="14" r="4" fill="currentColor"/><circle cx="31" cy="24" r="4" fill="currentColor"/><circle cx="21" cy="34" r="4" fill="currentColor"/>'),
  sun: wrap('<circle cx="24" cy="24" r="9" fill="currentColor"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/>'),
  lock: wrap('<path d="M13 22h22v18H13z"/><path d="M17 22v-6a7 7 0 0114 0v6"/>'),
};
