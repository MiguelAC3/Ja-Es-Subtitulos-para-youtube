// Agrupa los trozos de kuromoji en unidades como las que encuentra Yomitan:
// palabras completas (タメ口, お話, して → する, いきます → いく) identificadas
// por su entrada de JMdict, y por encima expresiones (気を付ける, について).
import { kataToHira, tokenSegments, type Segment, type Token } from "./furigana";
import { POS, type DictEntry, type Dictionary } from "./jmdict";

export interface Unit {
  text: string;
  // Forma de diccionario (付けて → 付ける); identifica la unidad en las frases guardadas.
  base: string;
  segments: Segment[];
  // Clave de palabra conocida: "j" + id de JMdict, o la forma base si no está en
  // JMdict. Sin clave = gramática (partículas, auxiliares…), no se marca.
  key?: string;
}

// Expresión que abarca las unidades [start, end).
export interface Span {
  start: number;
  end: number;
  key: string;
}

export interface AnalyzedLine {
  units: Unit[];
  expressions: Span[];
}

// Trozo de la línea en construcción: uno o varios tokens de kuromoji.
interface Piece {
  tokens: Token[];
  // Token que da la categoría gramatical y la forma de diccionario.
  head: Token;
  text: string;
  base: string;
  // Lectura del texto tal cual, en hiragana.
  reading?: string;
  key?: string;
}

const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞", "接続詞", "感動詞"]);
const MERGEABLE_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞", "接頭詞"]);
const CONTENT_FLAGS =
  POS.NOUN | POS.SURU_NOUN | POS.V1 | POS.V5 | POS.VS | POS.VK | POS.ADJ_I | POS.ADJ_NA | POS.ADV | POS.ADJ_PN | POS.INT | POS.CONJ;
const MAX_COMPOUND = 4;
const MAX_EXPRESSION = 6;

function readingOf(tokens: Token[]): string | undefined {
  let reading = "";
  for (const t of tokens) {
    if (!t.reading || t.reading === "*") return undefined;
    reading += t.reading;
  }
  return kataToHira(reading);
}

function pieceOf(tokens: Token[], head: Token): Piece {
  const text = tokens.map((t) => t.surface_form).join("");
  const base = head.basic_form && head.basic_form !== "*" ? head.basic_form : head.surface_form;
  // Solo cambia la forma del último token (付け|て → 付ける); lo anterior va tal cual.
  const prefix = tokens
    .slice(0, tokens.indexOf(head))
    .map((t) => t.surface_form)
    .join("");
  return { tokens, head, text, base: prefix + base, reading: readingOf(tokens) };
}

// Categorías de JMdict compatibles con lo que kuromoji dice del token.
function compatibleFlags(head: Token): number {
  switch (head.pos) {
    case "動詞": {
      const type = head.conjugated_type;
      if (type.startsWith("一段")) return POS.V1;
      if (type.startsWith("五段")) return POS.V5;
      if (type.startsWith("サ変")) return POS.VS;
      if (type.startsWith("カ変")) return POS.VK;
      return POS.V1 | POS.V5 | POS.VS | POS.VK;
    }
    case "形容詞":
      return POS.ADJ_I;
    case "副詞":
      return POS.ADV;
    case "連体詞":
      return POS.ADJ_PN;
    case "接続詞":
      return POS.CONJ;
    case "感動詞":
      return POS.INT;
    case "名詞":
      return POS.NOUN | POS.SURU_NOUN | POS.ADJ_NA | POS.ADV;
    default:
      return 0;
  }
}

const sameReading = (entry: DictEntry, reading: string) => entry.readings.some((r) => kataToHira(r) === reading);

// Coincide la lectura > encaja la categoría > es común; a igualdad, el orden de JMdict.
export function bestEntry(entries: DictEntry[], wanted = 0, reading?: string): DictEntry | undefined {
  let best: DictEntry | undefined;
  let bestScore = -1;
  for (const entry of entries) {
    const score =
      (reading && sameReading(entry, reading) ? 4 : 0) + (entry.flags & wanted ? 2 : 0) + (entry.common ? 1 : 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

// kuromoji lee お話して como お + 話し(sustantivo) + て, pero es お話 + して (la
// forma humilde お〜する). Si sin la し queda una palabra de JMdict, la し es する.
function splitHumbleSuru(tokens: Token[], dict: Dictionary): Token[] {
  return tokens.flatMap((t, i) => {
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (
      t.pos !== "名詞" ||
      t.surface_form.length < 2 ||
      !t.surface_form.endsWith("し") ||
      prev?.pos !== "接頭詞" ||
      !/^[おご御]$/.test(prev.surface_form) ||
      !next ||
      !(next.surface_form === "て" || next.basic_form === "た" || next.basic_form === "ます")
    ) {
      return [t];
    }
    const stem = t.surface_form.slice(0, -1);
    if (!dict.lookup(prev.surface_form + stem).length) return [t];
    const suru: Token = {
      ...t,
      surface_form: "し",
      basic_form: "する",
      reading: "シ",
      pronunciation: "シ",
      pos: "動詞",
      pos_detail_1: "自立",
      pos_detail_2: "*",
      pos_detail_3: "*",
      conjugated_type: "サ変・スル",
      conjugated_form: "連用形",
    };
    // El sustantivo conserva la lectura completa: お話して se lee おはなしして.
    return [{ ...t, surface_form: stem, basic_form: stem }, suru];
  });
}

// Verbos y adjetivos con su conjugación: し+て → して, いき+ます → いきます.
function attaches(token: Token, head: Token): boolean {
  const conjugable = head.pos === "動詞" || head.pos === "形容詞" || head.pos === "助動詞";
  if (token.pos === "助動詞") return conjugable;
  if (token.pos === "動詞" && token.pos_detail_1 === "接尾") return head.pos === "動詞";
  if (token.pos === "助詞" && token.pos_detail_1 === "接続助詞" && /^[てでば]$/.test(token.surface_form)) {
    return conjugable;
  }
  return false;
}

function toChunks(tokens: Token[]): Piece[] {
  const groups: { tokens: Token[]; head: Token }[] = [];
  for (const token of tokens) {
    const last = groups[groups.length - 1];
    if (last && attaches(token, last.head)) last.tokens.push(token);
    else groups.push({ tokens: [token], head: token });
  }
  return groups.map((g) => pieceOf(g.tokens, g.head));
}

// Entrada de JMdict para una secuencia de piezas: primero tal cual (タメ口,
// について), comprobando la lectura; si no, con la última pieza en forma de
// diccionario (気を付けて → 気を付ける), comprobando el tipo de verbo.
function matchSequence(pieces: Piece[], dict: Dictionary, accept: (e: DictEntry) => boolean): DictEntry | undefined {
  const last = pieces[pieces.length - 1];
  const prefix = pieces
    .slice(0, -1)
    .map((p) => p.text)
    .join("");
  const reading = pieces.every((p) => p.reading) ? pieces.map((p) => p.reading).join("") : undefined;
  const exact = dict.lookup(prefix + last.text).filter((e) => accept(e) && (!reading || sameReading(e, reading)));
  if (exact.length) return bestEntry(exact);
  if (last.base === last.text) return undefined;
  const wanted = compatibleFlags(last.head);
  return bestEntry(dict.lookup(prefix + last.base).filter((e) => accept(e) && e.flags & wanted));
}

function merge(pieces: Piece[], entry: DictEntry): Piece {
  const tokens = pieces.flatMap((p) => p.tokens);
  const last = pieces[pieces.length - 1];
  const prefix = pieces
    .slice(0, -1)
    .map((p) => p.text)
    .join("");
  const numbersOnly = tokens.every((t) => t.pos_detail_1 === "数");
  return {
    tokens,
    head: last.head,
    text: prefix + last.text,
    base: prefix + last.base,
    reading: readingOf(tokens),
    key: numbersOnly ? undefined : "j" + entry.id,
  };
}

// Una pieza que no es la última de un compuesto: sin conjugación añadida y, si
// es verbo o adjetivo, en forma de enlace (読み + 始める). En otra forma modifica
// a lo que sigue: ある人 en 興味がある人 no es "cierta persona".
function joinsNext(piece: Piece): boolean {
  if (piece.tokens.length > 1) return false;
  const { pos, conjugated_form } = piece.head;
  return (pos !== "動詞" && pos !== "形容詞") || conjugated_form.startsWith("連用");
}

// Palabras compuestas que kuromoji corta: タメ + 口 → タメ口, お + 話 → お話.
// Sin partículas en medio, y solo la última pieza puede estar conjugada.
function mergeCompounds(chunks: Piece[], dict: Dictionary): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < chunks.length; ) {
    let merged: Piece | undefined;
    for (let len = Math.min(MAX_COMPOUND, chunks.length - i); len >= 2 && !merged; len--) {
      const group = chunks.slice(i, i + len);
      const mergeable = group.every((p, k) => MERGEABLE_POS.has(p.head.pos) && (k === len - 1 || joinsNext(p)));
      if (!mergeable) continue;
      const entry = matchSequence(group, dict, (e) => (e.flags & CONTENT_FLAGS) !== 0);
      if (entry) {
        merged = merge(group, entry);
        i += len;
      }
    }
    if (!merged) merged = chunks[i++];
    out.push(merged);
  }
  return out;
}

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿々]/;
const KANJI = /[㐀-䶿一-鿿々]/;

function isMarkable(head: Token): boolean {
  if (!CONTENT_POS.has(head.pos) || head.pos_detail_1 === "数") return false;
  // nhk, web…: palabras extranjeras sin escritura japonesa.
  if (!JAPANESE.test(head.surface_form)) return false;
  // Los sufijos con kanji (犬 en ニュース犬, 的) tienen significado propio;
  // さん, たち… son gramática.
  if (head.pos_detail_1 === "接尾") return KANJI.test(head.surface_form);
  // の, ん: sustantivos de una sola kana que solo nominalizan. 中, こと o ため sí
  // son vocabulario, y también los verbos auxiliares como いく en 〜ていく.
  return !(head.pos === "名詞" && head.pos_detail_1 === "非自立" && /^[぀-ゟ]$/.test(head.surface_form));
}

function pieceKey(piece: Piece, dict: Dictionary | null): string | undefined {
  if (!isMarkable(piece.head)) return undefined;
  const conjugated = piece.text !== piece.base;
  const entry = dict && bestEntry(dict.lookup(piece.base), compatibleFlags(piece.head), conjugated ? undefined : piece.reading);
  return entry ? "j" + entry.id : piece.base;
}

// Verbo o adjetivo en forma de diccionario seguido de un sustantivo: es una
// oración que lo describe (興味がある人), no una expresión fija (ある人).
function modifiesNoun(group: Piece[]): boolean {
  return group.some(
    (p, k) =>
      k < group.length - 1 &&
      (p.head.pos === "動詞" || p.head.pos === "形容詞") &&
      p.head.conjugated_form === "基本形" &&
      group[k + 1].head.pos === "名詞",
  );
}

// Expresiones de JMdict (気を付ける, かもしれない) sobre las palabras ya
// agrupadas; han de incluir al menos una palabra con contenido.
function findExpressions(pieces: Piece[], dict: Dictionary): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let len = Math.min(MAX_EXPRESSION, pieces.length - i); len >= 2; len--) {
      const group = pieces.slice(i, i + len);
      if (!group.some((p) => p.key) || modifiesNoun(group)) continue;
      const entry = matchSequence(group, dict, (e) => (e.flags & POS.EXP) !== 0);
      if (entry) {
        spans.push({ start: i, end: i + len, key: "j" + entry.id });
        i += len - 1;
        break;
      }
    }
  }
  return spans;
}

export function analyzeLine(tokens: Token[], dict: Dictionary | null): AnalyzedLine {
  const chunks = toChunks(dict ? splitHumbleSuru(tokens, dict) : tokens);
  const pieces = dict ? mergeCompounds(chunks, dict) : chunks;
  for (const piece of pieces) piece.key ??= pieceKey(piece, dict);
  return {
    units: pieces.map((p) => ({
      text: p.text,
      base: p.base,
      segments: p.tokens.flatMap((t) => tokenSegments(t.surface_form, t.reading)),
      key: p.key,
    })),
    expressions: dict ? findExpressions(pieces, dict) : [],
  };
}

// Frases que el usuario marcó seleccionándolas: se guardan por sus formas de
// diccionario para reconocerlas aunque cambie la conjugación.
const PHRASE_PREFIX = "p:";

export function phraseKey(units: Unit[]): string {
  return PHRASE_PREFIX + units.map((u) => u.base).join("|");
}

export function findPhrases(units: Unit[], keys: Iterable<string>): Span[] {
  const spans: Span[] = [];
  for (const key of keys) {
    if (!key.startsWith(PHRASE_PREFIX)) continue;
    const bases = key.slice(PHRASE_PREFIX.length).split("|");
    for (let i = 0; i + bases.length <= units.length; i++) {
      if (bases.every((b, k) => units[i + k].base === b)) spans.push({ start: i, end: i + bases.length, key });
    }
  }
  return spans;
}

// Sin solapes: gana la más larga y, a igual longitud, la que viene antes en la
// lista (las frases del usuario van primero).
export function combineSpans(...lists: Span[][]): Span[] {
  const taken: Span[] = [];
  const all = lists.flat().sort((a, b) => b.end - b.start - (a.end - a.start));
  for (const span of all) {
    if (!taken.some((t) => span.start < t.end && t.start < span.end)) taken.push(span);
  }
  return taken.sort((a, b) => a.start - b.start);
}
