export const createBoundedTaskProgress = (
  publish: (progress: number, message: string) => void,
  options: { readonly minimumIntervalMs?: number; readonly now?: () => number } = {}
) => {
  const minimumIntervalMs = options.minimumIntervalMs ?? 100;
  const now = options.now ?? (() => performance.now());
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  return (progress: number, message: string) => {
    const timestamp = now();
    if (timestamp - lastPublishedAt < minimumIntervalMs) return;
    lastPublishedAt = timestamp;
    publish(progress, message);
  };
};
