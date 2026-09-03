// In-memory only, deliberately not persisted: a fresh process load of
// cert/active.pfx (i.e. a restart) is exactly what clears this, so it
// always reflects whether the currently-running listener matches the cert
// currently on disk.
let restartRequired = false;

export function markRestartRequired(): void {
  restartRequired = true;
}

export function isRestartRequired(): boolean {
  return restartRequired;
}
