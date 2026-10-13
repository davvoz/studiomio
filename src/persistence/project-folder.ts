import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { readText, writeText, type Directory } from './directory';
import { ProjectCodec } from './project-codec';

export const PROJECT_FILE = 'progetto.json';
export const BACKUP_FILE = 'progetto.bak.json';
export const AUDIO_DIR = 'audio';

export interface LoadedProject {
  readonly project: Project;
  /** Sample citati dal progetto ma assenti dalla cartella. */
  readonly missing: readonly SampleRef[];
}

/** Toglie dal nome i caratteri che i file system non accettano. */
export function safeFileName(name: string): string {
  const clean = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  return clean.slice(0, 120) || 'audio';
}

/** La cartella di un progetto:
 *    progetto.json      tracce, clip, marker, mixer (leggibile e confrontabile)
 *    progetto.bak.json  la versione salvata prima di quella attuale
 *    audio/             i file audio originali, copiati all'importazione */
export class ProjectFolder {
  constructor(readonly dir: Directory, private readonly codec = new ProjectCodec()) {}

  get name(): string {
    return this.dir.name;
  }

  hasProject(): Promise<boolean> {
    return this.dir.exists(PROJECT_FILE);
  }

  async save(project: Project): Promise<void> {
    const missing = await this.missingSamples(project);
    if (missing.length) throw new Error(`mancano i file audio: ${missing.map(s => s.file).join(', ')}`);
    const text = this.codec.stringify(project);
    // si serializza prima di toccare i file: se fallisce, la cartella resta com'era
    if (await this.dir.exists(PROJECT_FILE)) await this.dir.writeBytes(BACKUP_FILE, await this.dir.readBytes(PROJECT_FILE));
    await writeText(this.dir, PROJECT_FILE, text);
  }

  async load(): Promise<LoadedProject> {
    const project = this.codec.parse(await readText(this.dir, PROJECT_FILE));
    return { project, missing: await this.missingSamples(project) };
  }

  /** Copia un file audio in audio/ con un nome libero; restituisce il percorso relativo. */
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

  readAudio(sample: SampleRef): Promise<Uint8Array> {
    return this.dir.readBytes(sample.file);
  }

  /** File in audio/ che il progetto non usa più (da proporre all'utente per la pulizia). */
  async unusedAudio(project: Project): Promise<string[]> {
    const used = new Set(project.samples.map(s => s.file.toLowerCase()));
    return (await this.dir.list(AUDIO_DIR)).map(n => `${AUDIO_DIR}/${n}`).filter(p => !used.has(p.toLowerCase()));
  }

  private async missingSamples(project: Project): Promise<SampleRef[]> {
    const present = await Promise.all(project.samples.map(s => this.dir.exists(s.file)));
    return project.samples.filter((_, i) => !present[i]);
  }
}
