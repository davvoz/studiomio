import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeWav } from '../../src/dsp/codec/wav';
import { addMidiClip, addSample, addTrack } from '../../src/store/edits';
import { FileNotFoundError } from '../../src/persistence/directory';
import { buildLiveFolder, wavInfo } from '../../scripts/live-folder';
import { measureLoudness } from '../../scripts/loudness';
import { NodeDirectory } from '../../scripts/node-directory';
import { main as renderProjectMain } from '../../scripts/render-project';

const SR = 48000;
const sine = (amp: number, seconds: number) => Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / SR));

describe('loudness (BS.1770)', () => {
  it('a 1 kHz sine at −20 dBFS on both channels: about −20 LUFS, peak −20 dBTP', () => {
    const s = sine(0.1, 4);
    const m = measureLoudness(s, s, SR);
    expect(m.integrated).toBeCloseTo(-20, 0);
    expect(m.shortTermMax).toBeCloseTo(-20, 0);
    expect(m.truePeak).toBeCloseTo(-20, 0);
  });

  it('silence is gated out: no loudness to measure', () => {
    const z = new Float32Array(SR * 4);
    const m = measureLoudness(z, z, SR);
    expect(m.integrated).toBeLessThan(-100);
    expect(m.truePeak).toBeLessThan(-200);
  });
});

describe('WAV headers', () => {
  const wav = (bits: 16 | 24 | 32) => new Uint8Array(encodeWav([new Float32Array(100), new Float32Array(100)], SR, bits));

  it('format and length, from PCM and float files', () => {
    expect(wavInfo(wav(16), 'a.wav')).toEqual({ sampleRate: SR, channels: 2, frames: 100 });
    expect(wavInfo(wav(32), 'a.wav')).toEqual({ sampleRate: SR, channels: 2, frames: 100 });
  });

  it('what is not a WAV, or has no format or data, is refused by name', () => {
    expect(() => wavInfo(new TextEncoder().encode('RIFF0000AVI xxxxxxxx'), 'x.avi')).toThrow('x.avi: not a WAV');
    const noData = wav(16).slice(0, 36);
    expect(() => wavInfo(noData, 'cut.wav')).toThrow('cut.wav: no audio data');
    const dataFirst = wav(16);
    dataFirst.set(new TextEncoder().encode('data'), 12);
    expect(() => wavInfo(dataFirst, 'odd.wav')).toThrow('odd.wav: format missing before the data');
  });
});

describe('project folders from Node', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'studiomio-scripts-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('a folder on disk reads, writes, lists and removes files', async () => {
    const d = new NodeDirectory(join(dir, 'plain'));
    expect(d.name).toBe('plain');
    expect(await d.exists('a/b.txt')).toBe(false);
    await d.writeBytes('a/b.txt', new Uint8Array([1, 2]));
    expect(await d.exists('a/b.txt')).toBe(true);
    expect([...await d.readBytes('a/b.txt')]).toEqual([1, 2]);
    expect(await d.list('a')).toEqual(['b.txt']);
    expect(await d.list('')).toEqual([]);
    expect(await d.list('missing')).toEqual([]);
    await d.remove('a/b.txt');
    await expect(d.readBytes('a/b.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('a live is built from sound files (each copied once) and its mix rendered with the loudness', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const sounds = join(dir, 'sounds'), project = join(dir, 'live');
      await NodeDirectory.prototype.writeBytes.call(new NodeDirectory(sounds), 'kick.wav', new Uint8Array(encodeWav([sine(0.5, 1), sine(0.5, 1)], SR, 16)));
      let built = 0;
      await buildLiveFolder({ kick: 'kick.wav', again: 'kick.wav' }, sounds, project, (store, s) => {
        expect(s.kick).toBe(s.again);
        store.apply(addSample(s.kick));
        store.apply(addTrack('midi'));
        store.apply(addMidiClip(store.project.tracks[0].id, 0, 4));
        built++;
      });
      expect(built).toBe(1);
      expect(await new NodeDirectory(project).list('audio')).toEqual(['kick.wav']);
      const mix = join(dir, 'mix.24.wav'), stems = join(dir, 'stems');
      await renderProjectMain([project, mix, stems]);
      expect(wavInfo(new Uint8Array(await readFile(mix)), 'mix').channels).toBe(2);
      expect(log.mock.calls.some(c => String(c[0]).includes('LUFS integrated'))).toBe(true);
      await expect(renderProjectMain([project])).rejects.toThrow(/^usage/);
      await rm(join(project, 'audio', 'kick.wav'));
      await expect(renderProjectMain([project, mix])).rejects.toThrow(/^missing: /);
    } finally {
      log.mockRestore();
      out.mockRestore();
    }
  });
});
