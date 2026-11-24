/* The audio editor's context menu: on a marker, on the waveform (a marker there), elsewhere. */
import type { Beats } from '../../core/music-time';
import type { AudioClip } from '../../model/audio-clip';
import { KEY, SEPARATOR, type MenuItem } from '../context-menu';
import type { EditorHit } from './editor-gestures';
import { LAYOUT } from './editor-painter';

/** What the menu uses of the editor. */
export interface EditorMenuActions {
  /** The sample has been analysed: Auto-Warp and Follow tempo can be done. */
  readonly analysed: boolean;
  autoWarp(): void;
  followTempo(): Promise<void>;
  quantize(): void;
  resetMarkers(): void;
  setWarp(on: boolean): void;
  setReversed(on: boolean): void;
  crop(): Promise<void>;
  setOrigin(index: number): void;
  /** Deletes the chosen marker. */
  deleteMarker(): void;
  addMarkerAt(beat: Beats): void;
}

/** The menu for `hit` at (x, y); `beat` gives the beat under x (when the item runs). */
export function editorMenu(clip: AudioClip, hit: EditorHit, at: { readonly y: number; beat(): Beats }, a: EditorMenuActions): MenuItem[] {
  const warp = clip.warp.enabled;
  const tools: MenuItem[] = [
    { label: 'Auto-Warp', disabled: !a.analysed, run: () => a.autoWarp() },
    { label: 'Follow tempo', disabled: !a.analysed, run: () => void a.followTempo() },
    { label: 'Quantize the warp markers', disabled: !warp, run: () => a.quantize() },
    { label: 'Reset the warp markers', disabled: !warp, run: () => a.resetMarkers() },
    SEPARATOR,
    { label: warp ? 'Turn warp off' : 'Turn warp on', run: () => a.setWarp(!warp) },
    { label: clip.reversed ? 'Remove reverse' : 'Reverse', run: () => a.setReversed(!clip.reversed) },
    { label: clip.loop.enabled ? 'Crop to loop' : 'Crop to region', run: () => void a.crop() },
  ];
  if (hit.kind === 'marker') {
    const i = hit.index;
    return [
      { label: '1.1.1 here', run: () => a.setOrigin(i) },
      { label: 'Delete warp marker', shortcut: KEY.delete, disabled: !clip.warp.markers.canRemove(i), run: () => a.deleteMarker() },
      SEPARATOR,
      ...tools,
    ];
  }
  const here: MenuItem[] = at.y >= LAYOUT.ruler && warp ? [{ label: 'Add warp marker here', shortcut: 'double click', run: () => a.addMarkerAt(at.beat()) }, SEPARATOR] : [];
  return [...here, ...tools];
}
