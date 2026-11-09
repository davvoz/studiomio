declare const brand: unique symbol;

/** Typed identifier: a TrackId can't be passed where a ClipId is needed. */
export type Id<K extends string> = string & { readonly [brand]: K };

export type ProjectId = Id<'project'>;
export type TrackId = Id<'track'>;
export type ClipId = Id<'clip'>;
export type PlacementId = Id<'placement'>;
export type SampleId = Id<'sample'>;
export type SceneId = Id<'scene'>;
export type DeviceId = Id<'device'>;

/** Who creates the identifiers: injected, so tests use predictable ids. */
export interface IdFactory {
  next<K extends string>(kind: K): Id<K>;
}

export const randomIds: IdFactory = {
  next: <K extends string>(kind: K) => `${kind}-${crypto.randomUUID()}` as Id<K>,
};

/** Sequential ids per type (track-1, track-2, clip-1…): for tests and examples. */
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

/** Converts a string read from a file into an id (validating the format is up to the caller). */
export const asId = <K extends string>(value: string): Id<K> => value as Id<K>;
