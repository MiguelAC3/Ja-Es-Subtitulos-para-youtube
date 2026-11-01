import kuromoji from "kuromoji";
import BrowserDictionaryLoader from "kuromoji/src/loader/BrowserDictionaryLoader.js";

// El cargador original usa XHR + zlib.js en JS; desde el content script eso
// llena la consola de "Unsafe attempt to load URL". fetch + DecompressionStream
// es nativo y más rápido.
BrowserDictionaryLoader.prototype.loadArrayBuffer = (url, callback) => {
  fetch(url)
    .then((res) => new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer())
    .then(
      (buffer) => callback(null, buffer),
      (err) => callback(err, null),
    );
};

export interface Segment {
  text: string;
  reading?: string;
}

export type Token = kuromoji.IpadicFeatures;
export type Tokenizer = kuromoji.Tokenizer<Token>;

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヵヶ]/;

let tokenizer: Promise<Tokenizer> | null = null;

export function getTokenizer(): Promise<Tokenizer> {
  tokenizer ??= new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: chrome.runtime.getURL("dict/") }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
  return tokenizer;
}

export function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// Separa el okurigana para que la lectura quede solo sobre los kanji: 食べる → 食(た)べる.
export function tokenSegments(surface: string, reading: string | undefined): Segment[] {
  if (!reading || reading === "*" || !KANJI.test(surface)) return [{ text: surface }];
  const hira = kataToHira(reading);
  const surfHira = kataToHira(surface);

  let pre = 0;
  while (pre < surface.length && pre < hira.length && !KANJI.test(surface[pre]) && surfHira[pre] === hira[pre]) pre++;
  let suf = 0;
  while (
    suf < surface.length - pre &&
    suf < hira.length - pre &&
    !KANJI.test(surface[surface.length - 1 - suf]) &&
    surfHira[surfHira.length - 1 - suf] === hira[hira.length - 1 - suf]
  ) {
    suf++;
  }

  const segments: Segment[] = [];
  if (pre > 0) segments.push({ text: surface.slice(0, pre) });
  segments.push({ text: surface.slice(pre, surface.length - suf), reading: hira.slice(pre, hira.length - suf) });
  if (suf > 0) segments.push({ text: surface.slice(surface.length - suf) });
  return segments;
}
