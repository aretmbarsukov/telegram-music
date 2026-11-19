export const STORE_KEY = "luna-library-v1";

export function createClientStore(initialState) {
  let state = initialState;
  return {
    getState: () => state,
    setState: (next) => { state = next; },
    save: () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* Storage is optional. */ }
    },
  };
}
