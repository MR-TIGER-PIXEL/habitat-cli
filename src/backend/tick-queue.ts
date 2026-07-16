const queueByKey = new Map<string, Promise<unknown>>();

export function enqueueSerializedTickWork<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queueByKey.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(work);

  queueByKey.set(key, next);

  return next.finally(() => {
    if (queueByKey.get(key) === next) {
      queueByKey.delete(key);
    }
  });
}
