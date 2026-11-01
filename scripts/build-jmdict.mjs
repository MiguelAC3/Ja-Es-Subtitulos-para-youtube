// Convierte JMdict (formato JSON de jmdict-simplified) en el índice compacto que
// usa la extensión para reconocer palabras completas y expresiones:
//
//   forma \t id,flags,común[,lectura|lectura] ; id,flags,común ...
//
// Una línea por forma escrita (kanji o kana), ordenadas para búsqueda binaria.
// `flags` (base 36) resume las categorías gramaticales; las lecturas solo van en
// las formas con kanji. Solo hace falta volver a ejecutarlo para actualizar JMdict:
//
//   node scripts/build-jmdict.mjs jmdict-eng-X.json
//
// JMdict © Electronic Dictionary Research and Development Group, CC BY-SA 4.0.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

// Debe coincidir con POS en src/content/jmdict.ts.
const POS_BITS = [
  [1 << 0, /^(n|n-adv|n-t|n-pr|pn|adj-no)$/], // sustantivo
  [1 << 1, /^vs$/], // sustantivo que admite する
  [1 << 2, /^v1(-s)?$/], // verbo ichidan
  [1 << 3, /^v[245]/], // verbo godan (y clásicos)
  [1 << 4, /^(vs-[isc]|vz)$/], // verbo con する
  [1 << 5, /^vk$/], // 来る
  [1 << 6, /^adj-ix?$/], // adjetivo -い
  [1 << 7, /^adj-(na|nari|t)$/], // adjetivo -な
  [1 << 8, /^adv(-to)?$/], // adverbio
  [1 << 9, /^exp$/], // expresión
  [1 << 10, /^int$/], // interjección
  [1 << 11, /^adj-pn$/], // pre-nominal (この, 大きな)
  [1 << 12, /^conj$/], // conjunción
  [1 << 13, /^(prt|aux|aux-v|aux-adj|cop)$/], // gramática
  [1 << 14, /^(pref|suf|ctr|n-suf|n-pref)$/], // prefijo / sufijo
];

// Caracteres que usa el propio formato.
const RESERVED = /[\t\n;,|]/;

const [input, output = "data/jmdict.tsv.gz"] = process.argv.slice(2);
if (!input) {
  console.error("Uso: node scripts/build-jmdict.mjs <jmdict-eng-X.json> [salida]");
  process.exit(1);
}

const { words, dictDate } = JSON.parse(readFileSync(input, "utf8"));

function flagsOf(word) {
  let flags = 0;
  for (const sense of word.sense) {
    for (const pos of sense.partOfSpeech) {
      for (const [bit, re] of POS_BITS) if (re.test(pos)) flags |= bit;
    }
  }
  return flags;
}

const forms = new Map();
function add(form, ref) {
  if (RESERVED.test(form)) return;
  const refs = forms.get(form);
  if (refs) refs.push(ref);
  else forms.set(form, [ref]);
}

for (const word of words) {
  const flags = flagsOf(word).toString(36);
  for (const kanji of word.kanji) {
    const readings = word.kana
      .filter((r) => r.appliesToKanji.includes("*") || r.appliesToKanji.includes(kanji.text))
      .map((r) => r.text)
      .filter((r) => !RESERVED.test(r));
    add(kanji.text, `${word.id},${flags},${kanji.common ? 1 : 0},${readings.join("|")}`);
  }
  for (const kana of word.kana) add(kana.text, `${word.id},${flags},${kana.common ? 1 : 0}`);
}

const lines = [...forms.keys()].sort().map((form) => `${form}\t${forms.get(form).join(";")}`);
const gz = gzipSync(lines.join("\n"), { level: 9 });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, gz);
console.log(`JMdict ${dictDate}: ${words.length} entradas, ${lines.length} formas → ${output} (${(gz.length / 1e6).toFixed(1)} MB)`);
