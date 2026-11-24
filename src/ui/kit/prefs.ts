/* The view's preferences remembered by this browser (heights, open panels). Without local storage
 * (private window, blocked) nothing breaks: they last only while the app is open. */

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { /* remembered only while the app is open */ }
}
