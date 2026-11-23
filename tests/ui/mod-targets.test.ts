import { describe, expect, it } from 'vitest';
import { DEVICE_ON, INSTRUMENT_DEVICE, CLIP_TRANSPOSE, type ModTarget } from '../../src/model/envelope';
import { addEffect, setInstrumentParam } from '../../src/store/edits';
import {
  choiceTarget, deviceKeyOf, formatModValue, masterChain, masterTargetDevices, targetDevices, trackChain,
} from '../../src/ui/envelopes/mod-targets';
import { setup } from '../helpers/fixtures';

const VOLUME: ModTarget = { kind: 'mixer', param: 'volume' };
const PAN: ModTarget = { kind: 'mixer', param: 'pan' };
const PARAM: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'cutoff' };

describe('how a curve value is written', () => {
  it('volume as a percentage with its decibels, silence at zero', () => {
    expect(formatModValue(VOLUME, 0)).toBe('0 % (−∞ dB)');
    expect(formatModValue(VOLUME, 0.00005)).toBe('0 % (−∞ dB)');
    expect(formatModValue(VOLUME, 1)).toBe('100 % (0.0 dB)');
    expect(formatModValue(VOLUME, 0.5)).toBe('50 % (-12.0 dB)');
  });

  it('pan as centre, left or right', () => {
    expect(formatModValue(PAN, 0)).toBe('centre');
    expect(formatModValue(PAN, 0.004)).toBe('centre');
    expect(formatModValue(PAN, -0.5)).toBe('50 L');
    expect(formatModValue(PAN, 1)).toBe('100 R');
  });

  it('a parameter as a signed percentage', () => {
    expect(formatModValue(PARAM, 0.255)).toBe('+26 %');
    expect(formatModValue(PARAM, -0.5)).toBe('−50 %');
    expect(formatModValue(PARAM, 0)).toBe('0 %');
  });

  it('the clip transpose is the nearest semitone', () => {
    expect(formatModValue(CLIP_TRANSPOSE, 3.4)).toBe('+3 st');
    expect(formatModValue(CLIP_TRANSPOSE, -6.6)).toBe('−7 st');
    expect(formatModValue(CLIP_TRANSPOSE, 0.2)).toBe('0 st');
  });

  it('the device switch is On from halfway', () => {
    const onOff: ModTarget = { kind: 'device', device: 'fx1' as never, param: DEVICE_ON };
    expect(formatModValue(onOff, 0.5)).toBe('On');
    expect(formatModValue(onOff, 0.49)).toBe('Off');
  });

  it('deviceKeyOf is the device of a device target, otherwise the target kind', () => {
    expect(deviceKeyOf(PARAM)).toBe('instrument');
    expect(deviceKeyOf(VOLUME)).toBe('mixer');
    expect(deviceKeyOf(CLIP_TRANSPOSE)).toBe('clip');
  });
});

describe('what can be modulated on a track', () => {
  it('a MIDI track: mixer first, then the instrument, which has no on/off', () => {
    const { store } = setup({ midi: 1 });
    const devices = targetDevices(store.project.tracks[0]);
    expect(devices.map(d => d.key)).toEqual(['mixer', 'instrument']);
    expect(devices[0].sections[0].params.map(p => p.label)).toEqual(['Volume', 'Pan']);
    const inst = devices[1];
    expect(inst.sections.every(s => s.label !== 'Device')).toBe(true);
    const all = inst.sections.flatMap(s => s.params);
    expect(all.length).toBeGreaterThan(5);
    expect(all.every(p => p.target.kind === 'device' && p.target.device === INSTRUMENT_DEVICE)).toBe(true);
  });

  it('an audio track starts with its clip (transpose), then the mixer', () => {
    const { store } = setup({ audio: 1 });
    const devices = targetDevices(store.project.tracks[0]);
    expect(devices.map(d => d.key)).toEqual(['clip', 'mixer']);
    expect(devices[0].sections[0].params).toEqual([{ target: CLIP_TRANSPOSE, label: 'Transpose' }]);
  });

  it('an effect has its on/off first; two of the same type are numbered', () => {
    const { store, track } = setup({ midi: 1 });
    store.apply(addEffect(track(0), 'delay', 'Delay'));
    store.apply(addEffect(track(0), 'delay', 'Delay'));
    const devices = targetDevices(store.project.tracks[0]);
    expect(devices.map(d => d.label)).toEqual(['Mixer', devices[1].label, devices[2].label, devices[3].label]);
    const [first, second] = [devices[2], devices[3]];
    expect(second.label).toBe(`${first.label} 2`);
    expect(first.sections[0]).toEqual({ label: 'Device', params: [{ target: { kind: 'device', device: first.key, param: DEVICE_ON }, label: 'On/Off' }] });
    // a device key is the effect id, used by the targets
    expect(first.sections[1].params[0].target).toMatchObject({ kind: 'device', device: first.key });
  });

  it('trackChain describes the instrument, effects and order of a MIDI track; an audio track has no instrument', () => {
    const { store, track } = setup({ midi: 1, audio: 1 });
    store.apply(addEffect(track(1), 'reverb', 'Reverb'));
    const midi = trackChain(store.project.tracks[1]);
    expect(midi.instrument?.type).toBeDefined();
    expect(midi.chainKeys[0]).toBe(INSTRUMENT_DEVICE);
    const audio = trackChain(store.project.tracks[0]);
    expect(audio.instrument).toBeUndefined();
  });

  it('the master has no mixer entries: only its effects', () => {
    const { store } = setup();
    expect(masterTargetDevices(store.project)).toEqual([]);
    store.apply(addEffect('master', 'limiter', 'Limiter'));
    const devices = masterTargetDevices(store.project);
    expect(devices).toHaveLength(1);
    expect(devices[0].sections[0].label).toBe('Device');
    expect(masterChain(store.project).effects).toHaveLength(1);
  });
});

describe('choices heard through a modulation', () => {
  it('a choice of the instrument names the option heard with the offset', () => {
    const { store, track } = setup({ midi: 1 });
    const chain = trackChain(store.project.tracks[0]);
    const wave: ModTarget = { kind: 'device', device: INSTRUMENT_DEVICE, param: 'oscA' };
    const choice = choiceTarget(chain, wave);
    expect(choice).not.toBeNull();
    expect(choice!.spec.options.length).toBeGreaterThan(2);
    // the knob sits at the first option: no offset keeps it, the full offset reaches the last
    expect(choice!.heard(0)).toBe(0);
    expect(choice!.heard(1)).toBe(choice!.spec.options.length - 1);
    expect(formatModValue(wave, 1, chain)).toMatch(/ · \+100 %$/);
    expect(formatModValue(wave, 1, chain).startsWith(choice!.spec.options.at(-1)!)).toBe(true);
    // a base value set on the knob moves where the offset starts from
    store.apply(setInstrumentParam(track(0), 'oscA', choice!.spec.options.length - 1));
    const moved = choiceTarget(trackChain(store.project.tracks[0]), wave)!;
    expect(moved.baseUnit).toBeCloseTo(1, 9);
    expect(moved.heard(-1)).toBe(0);
  });

  it('numbers, the mixer, clips and unknown devices are not choices', () => {
    const { store } = setup({ midi: 1 });
    const chain = trackChain(store.project.tracks[0]);
    expect(choiceTarget(chain, PARAM)).toBeNull();
    expect(choiceTarget(chain, VOLUME)).toBeNull();
    expect(choiceTarget(chain, CLIP_TRANSPOSE)).toBeNull();
    expect(choiceTarget(chain, { kind: 'device', device: 'ghost' as never, param: 'x' })).toBeNull();
    expect(choiceTarget(chain, { kind: 'device', device: INSTRUMENT_DEVICE, param: 'nope' })).toBeNull();
    // an audio track has no instrument to look in
    const audio = trackChain(setup({ audio: 1 }).store.project.tracks[0]);
    expect(choiceTarget(audio, PARAM)).toBeNull();
    expect(formatModValue(PARAM, 0.5, null)).toBe('+50 %');
  });
});
