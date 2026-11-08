export function createNonOverlappingRunner(task: () => Promise<void>) {
  let active = false;
  return async (): Promise<boolean> => {
    if (active) return false;
    active = true;
    try { await task(); return true; }
    finally { active = false; }
  };
}
