// Índice de JMdict generado por scripts/build-jmdict.mjs: una línea por forma
// escrita, ordenadas, que se consultan con búsqueda binaria sobre el texto en
// vez de crear medio millón de objetos en cada pestaña.

// Debe coincidir con POS_BITS en scripts/build-jmdict.mjs.
export const POS = {
  NOUN: 1 << 0,
  SURU_NOUN: 1 << 1,
  V1: 1 << 2,
  V5: 1 << 3,
  VS: 1 << 4,
  VK: 1 << 5,
  ADJ_I: 1 << 6,
  ADJ_NA: 1 << 7,
  ADV: 1 << 8,
  EXP: 1 << 9,
  INT: 1 << 10,
  ADJ_PN: 1 << 11,
  CONJ: 1 << 12,
  GRAMMAR: 1 << 13,
  AFFIX: 1 << 14,
} as const;

export interface DictEntry {
  id: string;
  flags: number;
  // La forma buscada está marcada como común en JMdict.
  common: boolean;
  // Lecturas en kana de una forma con kanji; en las formas kana es la propia forma.
  readings: string[];
}

export class Dictionary {
  private readonly starts: Uint32Array;
  private readonly cache = new Map<string, DictEntry[]>();

  constructor(private readonly text: string) {
    let count = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++;
    this.starts = new Uint32Array(count);
    let line = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) this.starts[line++] = i + 1;
  }

  private formAt(line: number): string {
    const start = this.starts[line];
    return this.text.slice(start, this.text.indexOf("\t", start));
  }

  private payloadAt(line: number): string {
    const start = this.text.indexOf("\t", this.starts[line]) + 1;
    const end = line + 1 < this.starts.length ? this.starts[line + 1] - 1 : this.text.length;
    return this.text.slice(start, end);
  }

  lookup(form: string): DictEntry[] {
    const cached = this.cache.get(form);
    if (cached) return cached;
    let lo = 0;
    let hi = this.starts.length - 1;
    let entries: DictEntry[] = [];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const current = this.formAt(mid);
      if (current === form) {
        entries = this.payloadAt(mid)
          .split(";")
          .map((ref) => {
            const [id, flags, common, readings] = ref.split(",");
            return {
              id,
              flags: parseInt(flags, 36),
              common: common === "1",
              readings: readings === undefined ? [form] : readings.split("|"),
            };
          });
        break;
      }
      if (current < form) lo = mid + 1;
      else hi = mid - 1;
    }
    if (this.cache.size > 50_000) this.cache.clear();
    this.cache.set(form, entries);
    return entries;
  }
}

let dictionary: Promise<Dictionary> | null = null;

export function getDictionary(): Promise<Dictionary> {
  dictionary ??= fetch(chrome.runtime.getURL("jmdict.tsv.gz"))
    .then((res) => new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).text())
    .then((text) => new Dictionary(text));
  return dictionary;
}
