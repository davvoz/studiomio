/** Runs `job` on the items, in order, at most `limit` together: each starts as soon as one of those
 *  before has finished. After an error no more start; it comes out when those running have ended. */
export async function atMost<T>(limit: number, items: readonly T[], job: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    if (next >= items.length) return;
    const index = next++;
    try {
      await job(items[index], index);
    } catch (e) {
      next = items.length;
      throw e;
    }
    await worker();
  };
  const ended = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failed = ended.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Runs `job` on the items one at a time, in order: for jobs where each needs the one before finished
 *  (a free file name, a limit reached, the undo order, the memory of one file at a time). */
export const oneAtATime = <T>(items: readonly T[], job: (item: T, index: number) => Promise<void>): Promise<void> =>
  atMost(1, items, job);
