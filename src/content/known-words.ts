// Estado de cada palabra o expresión: conocida, para aprender o (si no está en
// ninguna lista) desconocida. Las claves son "j" + id de entrada de JMdict, la
// forma de diccionario si no está en JMdict, o "p:…" para las frases marcadas a
// mano. chrome.storage.onChanged mantiene sincronizadas las pestañas.

export type WordStatus = "unknown" | "learning" | "known";

const STORAGE_KEYS = { known: "knownWords", learning: "learningWords" } as const;
const VERSION_KEY = "knownWordsVersion";
const lists = { known: new Set<string>(), learning: new Set<string>() };
const listeners: (() => void)[] = [];

function notify() {
  for (const listener of listeners) listener();
}

function replaceAll(status: keyof typeof lists, words: string[]) {
  lists[status].clear();
  for (const word of words) lists[status].add(word);
  notify();
}

export function statusOf(key: string): WordStatus {
  if (lists.known.has(key)) return "known";
  if (lists.learning.has(key)) return "learning";
  return "unknown";
}

export function statusCounts(): { known: number; learning: number } {
  return { known: lists.known.size, learning: lists.learning.size };
}

// Todas las claves guardadas, en cualquiera de las dos listas.
export function savedKeys(): Iterable<string> {
  return [...lists.known, ...lists.learning];
}

// Marca con `status`; si ya lo tenía, vuelve a desconocida.
export function toggleStatus(key: string, status: "known" | "learning") {
  const next = statusOf(key) === status ? "unknown" : status;
  lists.known.delete(key);
  lists.learning.delete(key);
  if (next !== "unknown") lists[next].add(key);
  notify();
  void chrome.storage.local.set({
    [STORAGE_KEYS.known]: [...lists.known],
    [STORAGE_KEYS.learning]: [...lists.learning],
  });
}

export function onKnownWordsChange(listener: () => void) {
  listeners.push(listener);
}

// La versión 1 guardaba la forma de diccionario de kuromoji (食べる); se pasa
// una vez a la entrada de JMdict. Lo que ya está en el formato nuevo no cambia.
export async function migrateKnownWords(toEntryKey: (word: string) => string) {
  const saved = await chrome.storage.local.get({ [STORAGE_KEYS.known]: [], [VERSION_KEY]: 1 });
  if ((saved[VERSION_KEY] as number) >= 2) return;
  const words = (saved[STORAGE_KEYS.known] as string[]).map((w) =>
    /^j\d+$/.test(w) || w.startsWith("p:") ? w : toEntryKey(w),
  );
  await chrome.storage.local.set({ [STORAGE_KEYS.known]: [...new Set(words)], [VERSION_KEY]: 2 });
}

void chrome.storage.local.get({ [STORAGE_KEYS.known]: [], [STORAGE_KEYS.learning]: [] }).then((saved) => {
  replaceAll("known", saved[STORAGE_KEYS.known] as string[]);
  replaceAll("learning", saved[STORAGE_KEYS.learning] as string[]);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const status of ["known", "learning"] as const) {
    const change = changes[STORAGE_KEYS[status]];
    if (change) replaceAll(status, (change.newValue as string[] | undefined) ?? []);
  }
});
