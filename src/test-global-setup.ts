import { cleanupRunManifestDbs, reapStaleTestDbs } from "./test-utils/test-db";

/**
 * Vitest global setup: runs once in the main process before workers spawn
 * and tears down after all test files complete.
 */
export default function setup() {
  return () => {
    // Remove exactly this run's manifest-recorded databases (each entry is
    // ownership-checked; foreign entries are refused, never deleted), then
    // reap stale leftovers from killed runs.
    cleanupRunManifestDbs();
    reapStaleTestDbs();
  };
}
