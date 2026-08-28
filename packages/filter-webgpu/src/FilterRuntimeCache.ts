/**
 * Releases per-filter GPU state whose semantic owner no longer exists.
 *
 * Image-sized working textures live in FilterTargetPool; this helper is only
 * for the small, keyed buffers retained by individual filter cores.
 */
export const releaseInactiveFilterRuntimes = <Runtime>(
  runtimes: Map<string, Runtime>,
  activeKeys: ReadonlySet<string>,
  destroyRuntime: (runtime: Runtime) => void
): void => {
  for (const [key, runtime] of runtimes) {
    if (activeKeys.has(key)) continue;
    destroyRuntime(runtime);
    runtimes.delete(key);
  }
};

