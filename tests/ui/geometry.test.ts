import { describe, expect, it } from 'vitest';
import { TimeSignature } from '../../src/core/music-time';
import { placementEnd } from '../../src/model/arrangement';
import { addMidiClip, placeSample } from '../../src/store/edits';
import {
  ADAPTIVE_GRID, drawnGridStep, FADE_HANDLE_PX, fadeHandles, FIXED_GRIDS, geometryShowing, gridLabel, gridStep,
  MAX_PX_PER_BEAT, MIN_PX_PER_BEAT, nudgeGrid, rulerZoom, snapTo, TimelineGeometry, type GridSetting,
} from '../../src/ui/timeline/geometry';
import { setup } from '../helpers/fixtures';

const FOUR_FOUR = new TimeSignature(4, 4);

describe('timeline geometry: view', () => {
  it('zoom is held inside its limits and keeps the anchor beat still', () => {
    const g = new TimelineGeometry(24, 8);
    const z = g.zoomed(1e6, 100);
    expect(z.pxPerBeat).toBe(MAX_PX_PER_BEAT);
    expect(z.xToBeat(100)).toBeCloseTo(g.xToBeat(100), 9);
    expect(g.zoomed(0.01, 0).pxPerBeat).toBe(MIN_PX_PER_BEAT);
  });

  it('scrolling never goes before the start and keeps the zoom', () => {
    const g = new TimelineGeometry(30, 2, 5, 80).scrolled(-4, -9);
    expect([g.scrollBeat, g.scrollY, g.pxPerBeat, g.trackHeight]).toEqual([0, 0, 30, 80]);
  });

  it('tracks are laid out by index with the vertical scroll', () => {
    const g = new TimelineGeometry(24, 0, 10, 50);
    expect(g.trackTop(2)).toBe(90);
    expect(g.trackIndexAt(0)).toBe(0);
    expect(g.trackIndexAt(40)).toBe(1);
    expect(g.trackIndexAt(-20)).toBe(-1);
  });

  it('a drag in the ruler zooms exponentially: down in, up out, ×2 every ~58 px', () => {
    expect(rulerZoom(0)).toBe(1);
    expect(rulerZoom(58)).toBeCloseTo(2, 1);
    expect(rulerZoom(-58)).toBeCloseTo(0.5, 1);
  });

  it('geometryShowing fits a range with a margin and keeps the vertical scroll', () => {
    const g = new TimelineGeometry(24, 0, 33, 60);
    const v = geometryShowing(g, 8, 16, 800);
    expect(v.scrollY).toBe(33);
    expect(v.trackHeight).toBe(60);
    // the range is inside the view, centred, with margin on both sides
    expect(v.beatToX(8)).toBeGreaterThan(0);
    expect(v.beatToX(16)).toBeLessThan(800);
    expect(v.beatToX(12)).toBeCloseTo(400, 6);
  });

  it('geometryShowing on an empty range or a zero width stays inside the zoom limits', () => {
    const g = new TimelineGeometry();
    expect(geometryShowing(g, 4, 4, 800).pxPerBeat).toBeLessThanOrEqual(MAX_PX_PER_BEAT);
    expect(geometryShowing(g, 0, 1e6, 800).pxPerBeat).toBe(MIN_PX_PER_BEAT);
    expect(geometryShowing(g, 0, 4, 0).pxPerBeat).toBeGreaterThanOrEqual(MIN_PX_PER_BEAT);
    // never scrolls to a negative beat
    expect(geometryShowing(g, 0, 1, 800).scrollBeat).toBe(0);
  });
});

describe('timeline geometry: grid', () => {
  it('fixed grids give their value, bars follow the signature', () => {
    const labels = FIXED_GRIDS.map(f => f.label);
    expect(labels).toEqual(['1/32', '1/16', '1/8', '1/4', '1/2', '1 bar', '2 bars', '4 bars', '8 bars']);
    const at = (fixed: number, sig = FOUR_FOUR) => gridStep(24, sig, 14, { fixed, density: 0, triplet: false });
    expect(at(0)).toBe(1 / 8);
    expect(at(3)).toBe(1);
    expect(at(5)).toBe(4);
    expect(at(7, new TimeSignature(3, 4))).toBe(12);
  });

  it('triplets last 2/3 for steps shorter than a bar, not for bars', () => {
    const t = (fixed: number) => gridStep(24, FOUR_FOUR, 14, { fixed, density: 0, triplet: true });
    expect(t(3)).toBeCloseTo(2 / 3, 9);
    expect(t(5)).toBe(4);
    // adaptive with triplets: the finest triplet that is wide enough
    expect(gridStep(24, FOUR_FOUR, 14, { ...ADAPTIVE_GRID, triplet: true })).toBeCloseTo(2 / 3, 9);
  });

  it('the adaptive density halves or doubles the spacing', () => {
    const at = (density: number) => gridStep(28, FOUR_FOUR, 14, { ...ADAPTIVE_GRID, density });
    expect(at(0)).toBe(1 / 2);
    expect(at(-1)).toBe(1 / 4);
    expect(at(1)).toBe(1);
    // zoomed out far enough, the widest step is the last
    expect(gridStep(0.001, FOUR_FOUR)).toBe(32 * 4);
  });

  it('nudgeGrid moves a fixed grid through the list and an adaptive one through its density', () => {
    expect(nudgeGrid({ fixed: 3, density: 0, triplet: false }, 1).fixed).toBe(4);
    expect(nudgeGrid({ fixed: 0, density: 0, triplet: false }, -1).fixed).toBe(0);
    expect(nudgeGrid({ fixed: FIXED_GRIDS.length - 1, density: 0, triplet: false }, 1).fixed).toBe(FIXED_GRIDS.length - 1);
    let g: GridSetting = ADAPTIVE_GRID;
    for (let i = 0; i < 5; i++) g = nudgeGrid(g, 1);
    expect(g.density).toBe(2);
    for (let i = 0; i < 9; i++) g = nudgeGrid(g, -1);
    expect(g.density).toBe(-2);
    expect(g.fixed).toBeNull();
  });

  it('gridLabel names the grid with density and triplet marks', () => {
    expect(gridLabel(ADAPTIVE_GRID)).toBe('Adaptive');
    expect(gridLabel({ ...ADAPTIVE_GRID, density: 2 })).toBe('Adaptive +2');
    expect(gridLabel({ ...ADAPTIVE_GRID, density: -1 })).toBe('Adaptive -1');
    expect(gridLabel({ fixed: 2, density: 0, triplet: false })).toBe('1/8');
    expect(gridLabel({ fixed: 2, density: 0, triplet: true })).toBe('1/8 T');
  });

  it('drawnGridStep doubles a step whose lines would be too close, and passes bad input through', () => {
    expect(drawnGridStep(1, 24)).toBe(1);
    expect(drawnGridStep(1 / 8, 8)).toBe(1 / 2);
    expect(drawnGridStep(0, 24)).toBe(0);
    expect(drawnGridStep(1, 0)).toBe(1);
  });

  it('snapTo rounds to the nearest step', () => {
    expect(snapTo(1.3, 0.5)).toBe(1.5);
    expect(snapTo(1.2, 0.5)).toBe(1);
    expect(snapTo(-0.3, 1)).toBeCloseTo(0, 9);
  });
});

describe('fade handles', () => {
  it('audio clips wide enough have them, kept inside the clip, at the end of each fade', () => {
    const { store, track, sampleId } = setup({ audio: 1, sample: true });
    store.apply(placeSample(track(0), sampleId, 0));
    const pl = store.project.tracks[0].arrangement[0];
    const geo = new TimelineGeometry(24, 0);
    const none = fadeHandles(geo, pl)!;
    // without fades the handles sit on the clip's edges (pulled inside by half a handle)
    expect(none.in).toBeCloseTo(geo.beatToX(pl.start) + FADE_HANDLE_PX / 2, 6);
    const faded = fadeHandles(geo, { ...pl, fadeIn: 1, fadeOut: 2 })!;
    expect(faded.in).toBeCloseTo(geo.beatToX(1), 6);
    expect(faded.out).toBeCloseTo(geo.beatToX(placementEnd(pl) - 2), 6);
    expect(fadeHandles(new TimelineGeometry(1.5, 0), pl)).toBeNull();
  });

  it('MIDI clips have none', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addMidiClip(track(0), 0, 4));
    expect(fadeHandles(new TimelineGeometry(24, 0), store.project.tracks[0].arrangement[0])).toBeNull();
  });
});
