/* What the browser remembers from one start to the next: open or not, its width, the source chosen, the preview. */
import { readPref, writePref } from '../kit/prefs';

export interface BrowserSettings {
  open: boolean;
  width: number;
  source: string;
  preview: boolean;
}

const SETTINGS_KEY = 'studiomio.browser';
const MIN_WIDTH = 250, MAX_WIDTH = 640;
export const BROWSER_DEFAULTS: Readonly<BrowserSettings> = { open: true, width: 330, source: 'instruments', preview: true };

/** The width kept between the narrowest and the widest the browser can be. */
export const clampWidth = (width: number): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));

/** The saved settings; what's missing or wrong takes the default. */
export function loadSettings(): BrowserSettings {
  try {
    const raw = JSON.parse(readPref(SETTINGS_KEY) ?? '{}') as Partial<BrowserSettings>;
    return {
      open: typeof raw.open === 'boolean' ? raw.open : BROWSER_DEFAULTS.open,
      width: typeof raw.width === 'number' ? clampWidth(raw.width) : BROWSER_DEFAULTS.width,
      source: typeof raw.source === 'string' ? raw.source : BROWSER_DEFAULTS.source,
      preview: typeof raw.preview === 'boolean' ? raw.preview : BROWSER_DEFAULTS.preview,
    };
  } catch {
    return { ...BROWSER_DEFAULTS };
  }
}

export function saveSettings(settings: BrowserSettings): void {
  writePref(SETTINGS_KEY, JSON.stringify(settings));
}
