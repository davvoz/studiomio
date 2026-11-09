/** Typed RPC between the main thread and the workers. A protocol is a map
 *  command → { req, res }: client and worker share it, so the compiler
 *  checks command names, arguments and results on both sides. */
export type CommandMap = { [command: string]: { req: unknown; res: unknown } };

export type Command<C extends CommandMap> = keyof C & string;
export type RequestOf<C extends CommandMap, K extends Command<C>> = C[K]['req'];
export type ResultOf<C extends CommandMap, K extends Command<C>> = C[K]['res'];

export interface RpcRequest {
  readonly id: number;
  readonly command: string;
  readonly payload: unknown;
}

export type RpcResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

export type Handlers<C extends CommandMap> = {
  readonly [K in Command<C>]: (payload: RequestOf<C, K>) => ResultOf<C, K> | Promise<ResultOf<C, K>>;
};

/** What's needed of a worker: the browser's Worker satisfies it, the tests use a fake. */
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => unknown) | null;
}

/** Buffers to transfer (not copy) together with the value: those of the typed arrays, except
 *  the SharedArrayBuffers which are already shared. */
export function transferablesOf(value: unknown, out: Set<ArrayBuffer> = new Set()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) out.add(value.buffer);
  } else if (Array.isArray(value)) {
    for (const v of value) transferablesOf(v, out);
  } else if (value !== null && typeof value === 'object' && !(value instanceof ArrayBuffer)) {
    for (const v of Object.values(value)) transferablesOf(v, out);
  }
  return [...out];
}

/** Worker side: runs the requests one at a time, in order of arrival, after `ready`. */
export function serveRpc<C extends CommandMap>(
  port: MessagePortLike, handlers: Handlers<C>, ready: Promise<unknown> = Promise.resolve(),
): void {
  const table = handlers as unknown as Record<string, (p: unknown) => unknown>;
  let queue: Promise<unknown> = ready.catch(() => undefined);
  port.onmessage = (ev: MessageEvent) => {
    const req = ev.data as RpcRequest;
    queue = queue.then(async () => {
      const handler = table[req.command];
      try {
        if (!handler) throw new Error(`unknown command: ${req.command}`);
        const result = await handler(req.payload);
        port.postMessage({ id: req.id, ok: true, result } satisfies RpcResponse, transferablesOf(result));
      } catch (err) {
        const error = err instanceof Error ? err.stack ?? err.message : String(err);
        port.postMessage({ id: req.id, ok: false, error } satisfies RpcResponse);
      }
    });
  };
}
