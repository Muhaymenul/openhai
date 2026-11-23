/** Reuse an in-flight detail read when several save notifications arrive. */
export function coalesceRequest<T>(read: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const request = read().finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return request;
  };
}
