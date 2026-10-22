import { readZip, type ZipEntry } from '../dsp/codec/zip';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { MemoryDirectory, readText, writeText, type Directory } from './directory';
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
    await this.requireSamples(project);
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

  /** Raccogli e salva: il progetto con i soli sample che usa, come voci di uno ZIP dentro la
   *  cartella `root`. Estratto, è una cartella di progetto completa; non ci sono il backup né
   *  i file audio che il progetto non usa più. */
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

  /** File in audio/ che il progetto non usa più (da proporre all'utente per la pulizia). */
  async unusedAudio(project: Project): Promise<string[]> {
    const used = new Set(project.samples.map(s => s.file.toLowerCase()));
    return (await this.dir.list(AUDIO_DIR)).map(n => `${AUDIO_DIR}/${n}`).filter(p => !used.has(p.toLowerCase()));
  }

  private async requireSamples(project: Project): Promise<void> {
    const missing = await this.missingSamples(project);
    if (missing.length) throw new Error(`mancano i file audio: ${missing.map(s => s.file).join(', ')}`);
  }

  private async missingSamples(project: Project): Promise<SampleRef[]> {
    const present = await Promise.all(project.samples.map(s => this.dir.exists(s.file)));
    return project.samples.filter((_, i) => !present[i]);
  }
}

/** La cartella di progetto dentro uno ZIP (fatto con Raccogli e salva, o a mano), in memoria.
 *  È quella di progetto.json più in alto: lo ZIP può contenerla o esserla. `name`: il nome se
 *  la cartella è lo ZIP stesso. */
export async function unpackProject(zip: Uint8Array, name: string): Promise<MemoryDirectory> {
  const entries = await readZip(zip);
  const depth = (path: string) => path.split('/').length;
  const top = entries.map(e => e.name).filter(n => n === PROJECT_FILE || n.endsWith(`/${PROJECT_FILE}`))
    .sort((a, b) => depth(a) - depth(b))[0];
  if (top === undefined) throw new Error(`"${name}" non contiene un progetto studiomio`);
  const prefix = top.slice(0, -PROJECT_FILE.length);
  const dir = new MemoryDirectory(prefix ? prefix.slice(0, -1).split('/').pop() : name);
  for (const e of entries) {
    const path = e.name.slice(prefix.length);
    // niente fuori dalla cartella del progetto (né "..": splitPath lo rifiuterebbe)
    if (!e.name.startsWith(prefix) || path === BACKUP_FILE || path.split('/').includes('..')) continue;
    await dir.writeBytes(path, e.data);
  }
  return dir;
}
