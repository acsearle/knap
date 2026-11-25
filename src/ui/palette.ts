// The colour palette (§6.1): a small set of solid colours; the darkest is dark grey (not black)
// so outlines stay visible on it.
export interface Swatch {
  color: string;
  name: string;
}

export const PALETTE: readonly Swatch[] = [
  { color: '#e0b43c', name: 'Yellow' },
  { color: '#e07b2e', name: 'Orange' },
  { color: '#c8433a', name: 'Red' },
  { color: '#4c9a57', name: 'Green' },
  { color: '#3b74c4', name: 'Blue' },
  { color: '#e8e8e4', name: 'White' },
  { color: '#a8adb2', name: 'Light grey' },
  { color: '#5f6468', name: 'Dark grey' },
];
