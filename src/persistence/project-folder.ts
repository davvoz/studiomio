import { readZip, type ZipEntry } from '../dsp/codec/zip';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { MemoryDirectory, readText, writeText, type Directory } from './directory';
import { ProjectCodec } from './project-codec';

/** The project: its own extension, so that a double click on it opens studiomio. */
export const PROJECT_FILE = 'progetto.studiomio';
/** Where the versions up to 0.3.57 kept the project: it's still read, and saving moves it to
 *  PROJECT_FILE. */
export const LEGACY_PROJECT_FILE = 'progetto.json';
const PROJECT_FILES = [PROJECT_FILE, LEGACY_PROJECT_FILE] as const;
export const BACKUP_FILE = 'progetto.bak.json';
export const RECOVERY_FILE = 'progetto.recupero.json';
export const AUDIO_DIR = 'audio';

export interface LoadedProject {
  readonly project: Project;
  /** Samples referenced by the project but missing from the folder. */
  readonly missing: readonly SampleRef[];
}

/** Removes from the name the characters file systems don't accept. */
export function safeFileName(name: string): string {
  const clean = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  return clean.slice(0, 120) || 'audio';
}

/** A project's folder:
 *    progetto.studiomio tracks, clips, markers, mixer (JSON: readable and diffable; progetto.json
 *                       in the folders of the versions up to 0.3.57)
 *    progetto.bak.json  the version saved before the current one
 *    progetto.recupero.json  the changes not yet saved, written by themselves every so often: if
 *                       the app hangs or closes badly they're reopened from here (saving removes it)
 *    audio/             the original audio files, copied on import */
export class ProjectFolder {
  constructor(readonly dir: Directory, private readonly codec = new ProjectCodec()) {}

  get name(): string {
    return this.dir.name;
  }

  async hasProject(): Promise<boolean> {
    return (await this.savedFile()) !== null;
  }

  /** The file holding the saved project, null if there's none. */
  private async savedFile(): Promise<string | null> {
    for (const file of PROJECT_FILES) if (await this.dir.exists(file)) return file;
    return null;
  }

  async save(project: Project): Promise<void> {
    await this.requireSamples(project);
    const text = this.codec.stringify(project);
    // it's serialized before touching the files: if it fails, the folder stays as it was
    const saved = await this.savedFile();
    if (saved) await this.dir.writeBytes(BACKUP_FILE, await this.dir.readBytes(saved));
    await writeText(this.dir, PROJECT_FILE, text);
    if (saved === LEGACY_PROJECT_FILE) await this.dir.remove(LEGACY_PROJECT_FILE);
    await this.dir.markProject?.();
    await this.dropRecovery();
  }

  /** The recovery copy: the project as it is now, without touching the saved one. It doesn't check
   *  the audio files: it must succeed even halfway through a job. */
  async saveRecovery(project: Project): Promise<void> {
    await writeText(this.dir, RECOVERY_FILE, this.codec.stringify(project));
  }

  /** The recovery copy, if there is one and it can be read (a damaged copy mustn't prevent opening). */
  async loadRecovery(): Promise<LoadedProject | null> {
    if (!(await this.dir.exists(RECOVERY_FILE))) return null;
    try {
      const project = this.codec.parse(await readText(this.dir, RECOVERY_FILE));
      return { project, missing: await this.missingSamples(project) };
    } catch {
      return null;
    }
  }

  async dropRecovery(): Promise<void> {
    if (await this.dir.exists(RECOVERY_FILE)) await this.dir.remove(RECOVERY_FILE);
  }

  async load(): Promise<LoadedProject> {
    const file = await this.savedFile();
    if (!file) throw new Error(`"${this.name}" doesn't contain a studiomio project`);
    const project = this.codec.parse(await readText(this.dir, file));
    return { project, missing: await this.missingSamples(project) };
  }

  /** Copies an audio file into audio/ with a free name; returns the relative path. */
  async importAudio(fileName: string, data: Uint8Array): Promise<string> {
    const safe = safeFileName(fileName);
    const dot = safe.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ''];
    const taken = new Set((await this.dir.list(AUDIO_DIR)).map(n => n.toLowerCase()));
    let name = safe;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}${ext}`;
    const path = `${AUDIO_DIR}/${name}`;
    await this.dir.writeBytes(path, data);
    return path;
  }

  /** An audio file of another project (`path` relative to that folder): if this folder already has
   *  it identical at the same path it's used as it is, otherwise it's copied like an import.
   *  Returns the relative path here. */
  async adoptAudio(path: string, data: Uint8Array): Promise<string> {
    if (await this.dir.exists(path) && sameBytes(await this.dir.readBytes(path), data)) return path;
    return this.importAudio(path.slice(path.lastIndexOf('/') + 1), data);
  }

  /** Collect and save: the project with only the samples it uses, as entries of a ZIP inside the
   *  folder `root`. Extracted, it's a complete project folder; there's no backup, no
   *  recovery copy nor the audio files the project no longer uses. */
  async archive(project: Project, root: string): Promise<ZipEntry[]> {
    const collected = project.withoutUnusedSamples();
    await this.requireSamples(collected);
    const prefix = `${safeFileName(root)}/`;
    const files = [...new Set(collected.samples.map(s => s.file))];
    return [
      { name: prefix + PROJECT_FILE, data: new TextEncoder().encode(this.codec.stringify(collected)) },
      ...await Promise.all(files.map(async f => ({ name: prefix + f, data: await this.dir.readBytes(f) }))),
    ];
  }

  readAudio(sample: SampleRef): Promise<Uint8Array> {
    return this.dir.readBytes(sample.file);
  }

  /** Files in audio/ the project no longer uses (to offer the user for cleanup). */
  async unusedAudio(project: Project): Promise<string[]> {
    const used = new Set(project.samples.map(s => s.file.toLowerCase()));
    return (await this.dir.list(AUDIO_DIR)).map(n => `${AUDIO_DIR}/${n}`).filter(p => !used.has(p.toLowerCase()));
  }

  private async requireSamples(project: Project): Promise<void> {
    const missing = await this.missingSamples(project);
    if (missing.length) throw new Error(`audio files are missing: ${missing.map(s => s.file).join(', ')}`);
  }

  private async missingSamples(project: Project): Promise<SampleRef[]> {
    const present = await Promise.all(project.samples.map(s => this.dir.exists(s.file)));
    return project.samples.filter((_, i) => !present[i]);
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** The project folder inside a ZIP (made with Collect and save, or by hand), in memory.
 *  It's the one with the topmost project file (also progetto.json, of the older versions): the ZIP can contain it or be it. `name`: the name if
 *  the folder is the ZIP itself. */
export async function unpackProject(zip: Uint8Array, name: string): Promise<MemoryDirectory> {
  const entries = await readZip(zip);
  const depth = (path: string) => path.split('/').length;
  const isProject = (path: string) => PROJECT_FILES.some(f => path === f || path.endsWith(`/${f}`));
  const top = entries.map(e => e.name).filter(isProject).sort((a, b) => depth(a) - depth(b))[0];
  if (top === undefined) throw new Error(`"${name}" doesn't contain a studiomio project`);
  const prefix = top.slice(0, top.lastIndexOf('/') + 1);
  const dir = new MemoryDirectory(prefix ? prefix.slice(0, -1).split('/').pop() : name);
  for (const e of entries) {
    const path = e.name.slice(prefix.length);
    // nothing outside the project folder (nor "..": splitPath would reject it)
    if (!e.name.startsWith(prefix) || path === BACKUP_FILE || path === RECOVERY_FILE || path.split('/').includes('..')) continue;
    await dir.writeBytes(path, e.data);
  }
  return dir;
}
