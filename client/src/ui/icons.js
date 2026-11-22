// Schlichte SVG-Symbole (24×24, currentColor).
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" ${extra}>${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  disc: svg(`<circle cx="12" cy="12" r="9.5" ${stroke}/><circle cx="12" cy="12" r="2.5" ${stroke}/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5" ${stroke} opacity=".6"/>`),
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/>'),
  next: svg('<path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75l8.6-5.8a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2z" fill="currentColor"/><rect x="16.5" y="5" width="2.6" height="14" rx="1" fill="currentColor"/>'),
  prev: svg('<path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75L9 12.75a.9.9 0 0 1 0-1.5l8.6-5.8A.9.9 0 0 1 19 6.2z" fill="currentColor"/><rect x="4.9" y="5" width="2.6" height="14" rx="1" fill="currentColor"/>'),
  shuffle: svg(`<path d="M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 3.8C14.3 15 15.5 17 17.6 17H21M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.6 8.3c.8-.8 1.7-1.3 3-1.3H21M18 4l3 3-3 3M18 14l3 3-3 3" ${stroke}/>`),
  repeat: svg(`<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3" ${stroke}/>`),
  repeatOne: svg(`<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3" ${stroke}/><path d="M11.5 10.5l1.2-.8V14" ${stroke} stroke-width="1.6"/>`),
  volume: svg(`<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" ${stroke}/>`),
  mute: svg(`<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" ${stroke}/>`),
  search: svg(`<circle cx="11" cy="11" r="6.5" ${stroke}/><path d="M16 16l4.5 4.5" ${stroke}/>`),
  settings: svg(`<circle cx="12" cy="12" r="3" ${stroke}/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" ${stroke} stroke-width="1.6"/>`),
  help: svg(`<circle cx="12" cy="12" r="9.5" ${stroke}/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.8M12 17.2v.1" ${stroke}/>`),
  refresh: svg(`<path d="M20 11a8 8 0 0 0-14.5-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.6L20 16M20 20v-4h-4" ${stroke}/>`),
  dice: svg(`<rect x="4" y="4" width="16" height="16" rx="3.5" ${stroke}/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/>`),
  coverflow: svg(`<path d="M2 7l5 2v6l-5 2zM22 7l-5 2v6l5 2z" ${stroke} stroke-width="1.7"/><rect x="8.5" y="5.5" width="7" height="13" rx="1" ${stroke} stroke-width="1.7"/>`),
  shelf: svg(`<path d="M4 5v14M7 5v14M10 5v14M20 5v14M3 20h18" ${stroke} stroke-width="1.7"/><rect x="12.5" y="7" width="5" height="12" rx="1" ${stroke} stroke-width="1.7"/>`),
  wheel: svg(`<path d="M3 15c3-4 6-5.5 9-5.5s6 1.5 9 5.5" ${stroke} stroke-width="1.7"/><rect x="9.5" y="5" width="5" height="7" rx="1" ${stroke} stroke-width="1.7"/><rect x="3" y="9.5" width="3.5" height="5" rx="1" ${stroke} stroke-width="1.5"/><rect x="17.5" y="9.5" width="3.5" height="5" rx="1" ${stroke} stroke-width="1.5"/>`),
  open: svg(`<path d="M4 5h9v14H4zM13 5l7-2v18l-7-2" ${stroke}/>`),
  flip: svg(`<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5" ${stroke}/>`),
  booklet: svg(`<path d="M3 5.5c3-1 6-1 9 1 3-2 6-2 9-1V19c-3-1-6-1-9 1-3-2-6-2-9-1z" ${stroke}/><path d="M12 6.5V20" ${stroke}/>`),
  back: svg(`<path d="M15 5l-7 7 7 7" ${stroke}/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18" ${stroke}/>`),
  chevronLeft: svg(`<path d="M15 5l-7 7 7 7" ${stroke}/>`),
  chevronRight: svg(`<path d="M9 5l7 7-7 7" ${stroke}/>`),
  cloud: svg(`<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z" ${stroke}/><path d="M12 11v5M9.8 13.8L12 16l2.2-2.2" ${stroke}/>`),
  star: svg('<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor"/>'),
  starOutline: svg(`<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" ${stroke} stroke-width="1.8"/>`),
  pair: svg(`<rect x="3" y="5" width="9" height="13" rx="1.5" ${stroke} stroke-width="1.8"/><rect x="12" y="5" width="9" height="13" rx="1.5" ${stroke} stroke-width="1.8"/><path d="M5.5 9h4M14.5 9h4M14.5 12h4M14.5 15h2.5" ${stroke} stroke-width="1.4"/>`),
  gamepad: svg(`<path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 4a2.3 2.3 0 0 1-4 1.2L14.6 16H9.4l-1.8 1.7a2.3 2.3 0 0 1-4-1.2l-.6-4A4 4 0 0 1 7 8z" ${stroke}/><path d="M7.5 11v3M6 12.5h3" ${stroke}/><circle cx="16" cy="11.5" r="1" fill="currentColor"/><circle cx="17.8" cy="13.5" r="1" fill="currentColor"/>`)
};
