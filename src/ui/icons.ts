// Inline SVG icons (20×20, stroke = currentColor). Static, trusted markup.

const s = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  select: s('<path d="M5 3.5v12l3.2-3 2.3 5 2-1-2.3-4.8H15z" fill="currentColor" fill-opacity=".12"/>'),
  // a short liftarm end with a round hole
  pinHole: s('<rect x="2.5" y="5" width="15" height="10" rx="5"/><circle cx="7.5" cy="10" r="2.6"/><circle cx="12.5" cy="10" r="2.6"/>'),
  // round barrel with a cross bore
  axleHole: s('<circle cx="10" cy="10" r="7"/><path d="M8.9 6.8h2.2v2.1h2.1v2.2h-2.1v2.1H8.9v-2.1H6.8V8.9h2.1z"/>'),
  // cross-section of an axle + its length
  axle: s('<path d="M3 8.6h14M3 11.4h14" /><path d="M3 7v6M17 7v6"/><path d="M6 8.6v2.8M10 8.6v2.8M14 8.6v2.8" stroke-opacity=".45"/>'),
  // smooth pin: plain rod with chamfered ends
  pin: s('<path d="M4.5 7h11l1.5 1.5v3L15.5 13h-11L3 11.5v-3z"/>'),
  // friction pin: rod with ridges
  frictionPin: s('<path d="M4.5 7h11l1.5 1.5v3L15.5 13h-11L3 11.5v-3z"/><path d="M6.5 10h7" stroke-width="2.2"/>'),
  erase: s('<path d="M11.8 3.8 16.6 8.6 9.2 16H5.6L3.4 13.8z"/><path d="M7.6 8 12.4 12.8M9.2 16H17"/>'),
  newPart: s('<rect x="2.5" y="6.5" width="8" height="8" rx="1.5"/><path d="M14.5 3.5v6M11.5 6.5h6"/>'),
  // a face seen from the front, the face behind it dashed, an arrow straight through
  backSide: s('<rect x="2.5" y="7.5" width="9" height="9" rx="1"/><path d="M8.5 4.5h9v9h-3" stroke-dasharray="2 1.6"/><path d="M7 12l8.5-8.5M12 3.5h3.5V7"/>'),
  rotate: s('<path d="M15.5 9.5a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.2 2.8v3.1h-3.1"/>'),
  undo: s('<path d="M7.5 5 3.5 9l4 4"/><path d="M3.8 9H12a4.5 4.5 0 0 1 0 9h-2"/>'),
  redo: s('<path d="M12.5 5l4 4-4 4"/><path d="M16.2 9H8a4.5 4.5 0 0 0 0 9h2"/>'),
  play: s('<path d="M6.5 4.5v11l9-5.5z" fill="currentColor"/>'),
  stop: s('<rect x="5" y="5" width="10" height="10" rx="1.2" fill="currentColor"/>'),
  pause: s('<path d="M7 4.5v11M13 4.5v11" stroke-width="2.4"/>'),
  step: s('<path d="M5 4.5v11l7-5.5z" fill="currentColor"/><path d="M15 4.5v11" stroke-width="2"/>'),
  caret: s('<path d="M6 8l4 4 4-4"/>'),
  file: s('<path d="M5 2.5h6.5l3.5 3.5v11.5H5z"/><path d="M11.5 2.5V6H15"/>'),
  open: s('<path d="M2.5 5.5v10h12.5l2.5-7H6.2l-2.2 7"/><path d="M2.5 5.5V4h5l1.5 1.5h6v3"/>'),
  save: s('<path d="M10 3v9.5M6 8.8l4 4 4-4"/><path d="M3.5 13.5v3h13v-3"/>'),
  help: s('<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.3 2.1c-.7.3-1.1.9-1.1 1.6v.4"/><circle cx="10" cy="14.4" r=".4" fill="currentColor"/>'),
  info: s('<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><circle cx="10" cy="6.3" r=".4" fill="currentColor"/>'),
  kinematics: s('<circle cx="6" cy="10" r="2.6"/><circle cx="14" cy="10" r="2.6"/><path d="M8.6 10h2.8"/>'),
  close: s('<path d="M5 5l10 10M15 5 5 15"/>'),
} as const;

export type IconName = keyof typeof ICONS;
