export const LIMITS = {
  html: 3000,
  text: 500,
  ancestors: 6,
  styles: 24,
  attributes: 40,
  components: 30,
  screenshotBytes: 500 * 1024,
  payloadBytes: 1024 * 1024,
  maxSelections: 10,
  note: 2000,
} as const;
