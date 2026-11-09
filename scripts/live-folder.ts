/* Builds a live (src/demo) as a studiomio project folder: copies the sound files into
 * audio/, reads their format and duration from the WAV header, assembles the project and saves it. */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { sequentialIds } from '../src/core/id';
import { Project } from '../src/model/project';
import type { SampleRef } from '../src/model/sample';
import { ProjectFolder } from '../src/persistence/project-folder';
import { ProjectStore } from '../src/store/project-store';
import { NodeDirectory } from './node-directory';

/** Format and length of a WAV from its header (PCM or float, also "extensible"). */
export function wavInfo(bytes: Uint8Array, name: string): { sampleRate: number; channels: number; frames: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${name}: not a WAV`);
  let channels = 0, sampleRate = 0, bits = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), size = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(at + 10, true);
      sampleRate = v.getUint32(at + 12, true);
      bits = v.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (!channels || !bits) throw new Error(`${name}: format missing before the data`);
      const size32 = Math.min(size, bytes.length - at - 8);
      return { sampleRate, channels: Math.min(2, channels), frames: Math.floor(size32 / (channels * (bits / 8))) };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${name}: no audio data`);
}

/** Copies the sounds (paths relative to `soundsDir`), assembles the live with `build` and saves to
 *  `projectDir`. */
export async function buildLiveFolder<S extends string>(
  files: Readonly<Record<S, string>>, soundsDir: string, projectDir: string,
  build: (store: ProjectStore, sounds: Readonly<Record<S, SampleRef>>) => void,
): Promise<void> {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('New live', ids), ids);
  const folder = new ProjectFolder(new NodeDirectory(projectDir));
  const sounds = {} as Record<S, SampleRef>;
  // the same file for several roles is copied once
  const copied = new Map<string, SampleRef>();
  for (const key of Object.keys(files) as S[]) {
    const path = join(soundsDir, files[key]), name = basename(path);
    let ref = copied.get(path);
    if (!ref) {
      const bytes = new Uint8Array(await readFile(path));
      const info = wavInfo(bytes, name);
      const file = await folder.importAudio(name, bytes);
      ref = { id: ids.next('sample'), name: name.replace(/\.[^.]+$/, ''), file, ...info, analysis: null };
      copied.set(path, ref);
    }
    sounds[key] = ref;
    console.log(`  ${key.padEnd(11)} ${name} (${(ref.frames / ref.sampleRate).toFixed(2)} s, ${ref.sampleRate} Hz)`);
  }
  build(store, sounds);
  await folder.save(store.project);
  const p = store.project;
  console.log(`"${p.name}": ${p.tracks.length} tracks, ${p.scenes.length} scenes, ${p.samples.length} samples,`
    + `${Math.max(...p.tracks.map(t => t.arrangementEnd)) / 4} bars on the timeline → ${projectDir}`);
}
