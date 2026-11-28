import { describe, expect, it } from 'vitest';
import { mixerGates } from '../../src/engine/mixer-graph';
import { MASTER, type Project } from '../../src/model/project';
import { sidechainLinks } from '../../src/model/sidechain';
import { neededChannels, renderableTracks, stemTracks, trackRenderProject, trackSpan } from '../../src/model/track-render';
import type { Track } from '../../src/model/track';
import { addBus, addEffect, addMidiClip, groupTracks, setEffectSidechain, setMasterMixer, setMixer, setSend } from '../../src/store/edits';
import { setup } from '../helpers/fixtures';

/** Kick, bass (sidechained to the kick, in a group with the lead), lead, pad (sending to a bus); master with an effect. */
function rig() {
  const r = setup({ midi: 4 });
  const [kick, bass, lead, pad] = [0, 1, 2, 3].map(r.track);
  const { store } = r;
  for (const t of [kick, bass, lead, pad]) store.apply(addMidiClip(t, 4, 8));
  store.apply(addEffect(bass, 'compressor', 'Compressor'));
  store.apply(setEffectSidechain(bass, store.project.effectsOf(bass)[0].id, kick));
  store.apply(groupTracks([bass, lead]));
  const group = store.project.track(bass)!.group!;
  store.apply(addBus());
  store.apply(addBus());
  const [reverb, delay] = store.project.buses.map(b => b.id);
  store.apply(setSend(pad, reverb, -6));
  store.apply(setSend(group, delay, -3));
  store.apply(addEffect(MASTER, 'compressor', 'Glue'));
  store.apply(setMasterMixer({ volumeDb: -4 }));
  store.apply(setMixer(pad, { volumeDb: -2, pan: 0.5, mute: true }));
  store.apply(setMixer(lead, { solo: true }));
  return { ...r, kick, bass, lead, pad, group, reverb, delay };
}

const ids = (tracks: readonly Track[]) => tracks.map(t => t.id);
const heard = (p: Project) => mixerGates(p.tracks, p.buses).audible;

describe('a track rendered by itself', () => {
  it('the tracks with clips, not the groups; their span on the timeline', () => {
    const r = rig();
    const p = r.store.project;
    expect(ids(renderableTracks(p))).toEqual([r.kick, r.bass, r.lead, r.pad]);
    // the stems: not the muted ones, nor those in a muted group
    expect(ids(stemTracks(p))).toEqual([r.kick, r.bass, r.lead]);
    r.store.apply(setMixer(r.group, { mute: true }));
    expect(ids(stemTracks(r.store.project))).toEqual([r.kick]);
    expect(trackSpan(p.track(r.kick)!)).toEqual({ start: 4, end: 12 });
  });

  it('a stem: through its groups and into the buses they send to, without the master; only it is heard', () => {
    const r = rig();
    const p = trackRenderProject(r.store.project, r.bass, 'stem');
    // the kick stays (the bass listens to it), the lead and the pad go away; the delay is the group's bus
    expect(ids(p.tracks)).toEqual([r.kick, r.group, r.bass]);
    expect(ids(p.buses)).toEqual([r.delay]);
    expect(sidechainLinks(p)).toHaveLength(1);
    expect(p.masterEffects).toEqual([]);
    expect(p.master).toMatchObject({ volumeDb: 0, mute: false });
    expect(p.masterAutomationOn).toBe(false);
    expect([...heard(p)].sort()).toEqual([r.bass, r.group, r.delay].sort());
  });

  it('a muted track rendered by itself is heard, with its mixer and its sends', () => {
    const r = rig();
    const p = trackRenderProject(r.store.project, r.pad, 'stem');
    expect(ids(p.tracks)).toEqual([r.pad]);
    expect(ids(p.buses)).toEqual([r.reverb]);
    expect(p.track(r.pad)!.mixer).toEqual({ volumeDb: -2, pan: 0.5, mute: false, solo: true });
    expect([...heard(p)].sort()).toEqual([r.pad, r.reverb].sort());
  });

  it('a bounce: only its chain, outside its groups, without sends, at 0 dB in the middle', () => {
    const r = rig();
    const bass = trackRenderProject(r.store.project, r.bass, 'bounce');
    expect(ids(bass.tracks)).toEqual([r.kick, r.bass]);
    expect(bass.track(r.bass)!.group).toBeNull();
    expect(bass.buses).toEqual([]);
    const pad = trackRenderProject(r.store.project, r.pad, 'bounce');
    expect(pad.track(r.pad)!.mixer).toEqual({ volumeDb: 0, pan: 0, mute: false, solo: true });
    expect(pad.track(r.pad)!.sends).toEqual({});
  });

  it('a group listened to (sidechain) is its tracks; a group passed through stays alone', () => {
    const r = rig();
    r.store.apply(addEffect(r.pad, 'compressor', 'Compressor'));
    r.store.apply(setEffectSidechain(r.pad, r.store.project.effectsOf(r.pad)[0].id, r.group));
    const p = r.store.project;
    expect([...neededChannels(p, [r.pad])].sort()).toEqual([r.pad, r.group, r.bass, r.lead, r.kick].sort());
    expect([...neededChannels(p, [r.lead])].sort()).toEqual([r.lead, r.group].sort());
  });
});
