declare const brand: unique symbol;

/** Identificatore tipizzato: un TrackId non si può passare dove serve un ClipId. */
export type Id<K extends string> = string & { readonly [brand]: K };

export type ProjectId = Id<'project'>;
export type TrackId = Id<'track'>;
export type ClipId = Id<'clip'>;
export type PlacementId = Id<'placement'>;
export type SampleId = Id<'sample'>;
export type SceneId = Id<'scene'>;

/** Chi crea gli identificatori: iniettato, così i test usano id prevedibili. */
export interface IdFactory {
  next<K extends string>(kind: K): Id<K>;
}

export const randomIds: IdFactory = {
  next: <K extends string>(kind: K) => `${kind}-${crypto.randomUUID()}` as Id<K>,
};

/** Id progressivi per tipo (track-1, track-2, clip-1…): per test ed esempi. */
export function sequentialIds(): IdFactory {
  const counters = new Map<string, number>();
  return {
    next: <K extends string>(kind: K) => {
      const n = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, n);
      return `${kind}-${n}` as Id<K>;
    },
  };
}

/** Converte una stringa letta da file in un id (la validazione del formato spetta al chiamante). */
export const asId = <K extends string>(value: string): Id<K> => value as Id<K>;
