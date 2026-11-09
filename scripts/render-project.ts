/* The timeline mix of a project folder, computed in Node (see headless-render.ts):
 *   node scripts/run.mjs scripts/render-project.ts <project folder> <mix.wav> [stems folder]
 * The WAV is 32-bit float, 48 kHz (24-bit if the name ends with ".24.wav"). Prints the
 * loudness (BS.1770: integrated, maximum short-term, true peak). */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SampleId } from '../src/core/id';
import type { SampleData } from '../src/devices/dsp/core';
import { encodeWav } from '../src/dsp/codec/wav';
import { ProjectFolder } from '../src/persistence/project-folder';
import { decodeWav, renderProject } from './headless-render';
import { measureLoudness } from './loudness';
import { NodeDirectory } from './node-directory';

export async function main([projectDir, out, stemsDir]: string[]): Promise<void> {
  if (!projectDir || !out) throw new Error('usage: render-project.ts <project folder> <mix.wav> [stems folder]');
  const folder = new ProjectFolder(new NodeDirectory(projectDir));
  const { project, missing } = await folder.load();
  if (missing.length) throw new Error(`missing: ${missing.map(s => s.file).join(', ')}`);
  const samples = new Map<SampleId, SampleData>();
  for (const s of project.samples) samples.set(s.id, decodeWav(await folder.readAudio(s)));
  const t0 = performance.now();
  const r = renderProject(project, samples, {
    stems: !!stemsDir,
    onProgress: f => process.stdout.write(`\r  ${(f * 100).toFixed(0)} %`),
  });
  const secs = r.left.length / r.sampleRate;
  console.log(`\r"${project.name}": ${secs.toFixed(1)} s computed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const m = measureLoudness(r.left, r.right, r.sampleRate);
  console.log(`  ${m.integrated.toFixed(1)} LUFS integrated · short-term max ${m.shortTermMax.toFixed(1)} LUFS · true peak ${m.truePeak.toFixed(2)} dBTP`);
  await writeFile(out, new Uint8Array(encodeWav([r.left, r.right], r.sampleRate, out.endsWith('.24.wav') ? 24 : 32)));
  if (stemsDir) {
    await mkdir(stemsDir, { recursive: true });
    for (const [name, s] of r.stems) await writeFile(join(stemsDir, `${name}.wav`), new Uint8Array(encodeWav([s.l, s.r], r.sampleRate, 32)));
  }
}
