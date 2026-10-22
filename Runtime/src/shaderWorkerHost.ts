// Only the translator imports this host inside its isolated worker.
// Results return to the game, which saves them in the player's normal translation store.
const g = globalThis as any;
const store = new Map<string, string>();
export const host = {
  shaderPreparation: true,
  readFile: (url: string) => g.__readFile(url) as ArrayBuffer | null,
  log: (level: string, text: string) => g.__log(level, text),
  storage: {load: (key: string) => store.get(key) ?? null, save: (key: string, value: string) => {store.set(key, value);}},
};
