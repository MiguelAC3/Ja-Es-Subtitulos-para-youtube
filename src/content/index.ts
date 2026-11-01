// Mundo aislado: recibe los cues de inject.js, añade furigana y dibuja
// japonés arriba / español abajo en la parte inferior del reproductor.
import { MSG_SOURCE, activeCueIndex, lastStartedIndex, type BridgeMessage, type Cue } from "../shared/captions";
import { createControls, createSubtitleNav, isolateFromPlayer } from "./controls";
import { getTokenizer, type Segment } from "./furigana";
import { getDictionary, type Dictionary } from "./jmdict";
import {
  migrateKnownWords,
  onKnownWordsChange,
  savedKeys,
  statusCounts,
  statusOf,
  toggleStatus,
  type WordStatus,
} from "./known-words";
import { analyzeLine, bestEntry, combineSpans, findPhrases, phraseKey, type AnalyzedLine, type Span } from "./words";

interface State {
  videoId: string;
  ja: Cue[];
  es: Cue[];
  jaLines: (AnalyzedLine | undefined)[];
}

const DEFAULT_SETTINGS = { enabled: true, showEs: true, bgOpacity: 0.45, fontScale: 1, pauseOnHover: true };
type Settings = typeof DEFAULT_SETTINGS;

let state: State | null = null;
let shownJa = -2;
let shownEs = -2;
const settings: Settings = { ...DEFAULT_SETTINGS };

const overlay = document.createElement("div");
overlay.className = "ytj-overlay";
const jaLine = document.createElement("div");
jaLine.className = "ytj-line ytj-ja";
jaLine.lang = "ja";
const esLine = document.createElement("div");
esLine.className = "ytj-line ytj-es";
esLine.lang = "es";
overlay.append(jaLine, esLine);

const esButton = document.createElement("button");
esButton.className = "ytp-button ytj-es-button";
esButton.title = "Mostrar subtítulos en español";
const esLabel = document.createElement("span");
esLabel.className = "ytj-es-label";
esLabel.textContent = "ES";
esButton.append(esLabel);
esButton.addEventListener("click", () => updateSettings({ showEs: !settings.showEs }));

isolateFromPlayer(overlay);
isolateFromPlayer(esButton);

// Clave de la palabra bajo el cursor o, con Alt, de la expresión subrayada.
function keyAt(target: Element, expression: boolean): string | undefined {
  return expression
    ? target.closest<HTMLElement>(".ytj-expr")?.dataset.key
    : target.closest<HTMLElement>(".ytj-word")?.dataset.word;
}

// Clic izquierdo: conocida (blanco); clic derecho: para aprender (naranja). Un
// segundo clic con el mismo botón la devuelve a desconocida (morado). El clic
// izquierdo espera al posible doble clic que selecciona texto (Yomitan).
let pendingToggle = 0;
jaLine.addEventListener("click", (e) => {
  clearTimeout(pendingToggle);
  const key = keyAt(e.target as Element, e.altKey);
  if (!key || !document.getSelection()?.isCollapsed) return;
  if (e.altKey) toggleStatus(key, "known");
  else if (e.detail === 1) pendingToggle = window.setTimeout(() => toggleStatus(key, "known"), 250);
});

jaLine.addEventListener("contextmenu", (e) => {
  // Con texto seleccionado se deja el menú normal, para poder copiar.
  const key = keyAt(e.target as Element, e.altKey);
  if (!key || !document.getSelection()?.isCollapsed) return;
  e.preventDefault();
  clearTimeout(pendingToggle);
  toggleStatus(key, "learning");
});

// Al seleccionar varias palabras aparecen dos botones para marcarlas como frase
// conocida o para aprender; si coinciden con una expresión detectada, se marca
// esa expresión.
const phraseBar = document.createElement("div");
phraseBar.className = "ytj-phrase-bar";
phraseBar.hidden = true;
isolateFromPlayer(phraseBar);
// Sin esto, el clic borraría la selección antes de leerla.
phraseBar.addEventListener("mousedown", (e) => e.preventDefault());
let selectedKey = "";

const phraseButtons = (["known", "learning"] as const).map((status) => {
  const button = document.createElement("button");
  button.className = `ytj-phrase-button ytj-phrase-${status}`;
  button.textContent = status === "known" ? "Conocida" : "Para aprender";
  button.addEventListener("click", () => {
    if (!selectedKey) return;
    toggleStatus(selectedKey, status);
    document.getSelection()?.removeAllRanges();
  });
  phraseBar.append(button);
  return { status, button };
});

// Unidades [inicio, fin) que toca la selección, si son al menos dos.
function selectedUnits(): [number, number] | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!jaLine.contains(range.commonAncestorContainer)) return null;
  const indices: number[] = [];
  for (const el of jaLine.querySelectorAll<HTMLElement>(".ytj-unit")) {
    const unit = document.createRange();
    unit.selectNodeContents(el);
    // Se solapan si la selección acaba después del inicio de la unidad y empieza antes de su final.
    if (
      range.compareBoundaryPoints(Range.START_TO_END, unit) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, unit) < 0
    ) {
      indices.push(Number(el.dataset.i));
    }
  }
  return indices.length >= 2 ? [indices[0], indices[indices.length - 1] + 1] : null;
}

function updatePhraseBar() {
  const player = overlay.parentElement;
  const units = shown && player ? selectedUnits() : null;
  if (!shown || !player || !units) {
    phraseBar.hidden = true;
    selectedKey = "";
    return;
  }
  const [start, end] = units;
  const expression = shown.spans.find((s) => s.start === start && s.end === end);
  selectedKey = expression?.key ?? phraseKey(shown.line.units.slice(start, end));
  // El botón del estado actual queda pulsado; pulsarlo otra vez lo quita.
  const current = statusOf(selectedKey);
  for (const { status, button } of phraseButtons) {
    button.setAttribute("aria-pressed", String(current === status));
    button.title = current === status ? "Quitar" : "";
  }
  if (phraseBar.parentElement !== player) player.append(phraseBar);
  phraseBar.hidden = false;
  const rect = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
  const p = player.getBoundingClientRect();
  phraseBar.style.left = `${rect.left + rect.width / 2 - p.left}px`;
  phraseBar.style.top = `${rect.top - p.top - 4}px`;
}

document.addEventListener("selectionchange", updatePhraseBar);

const controls = createControls({
  onEnabledChange: (enabled) => updateSettings({ enabled }),
  onBgOpacityChange: (bgOpacity) => updateSettings({ bgOpacity }),
  onFontScaleChange: (fontScale) => updateSettings({ fontScale }),
  onPauseOnHoverChange: (pauseOnHover) => updateSettings({ pauseOnHover }),
});

const nav = createSubtitleNav({
  onPrev: () => goToLine(-1),
  onRepeat: () => goToLine(0),
  onNext: () => goToLine(1),
});

function playerVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("#movie_player video.html5-main-video");
}

// Al saltar al inicio exacto de una línea, currentTime puede quedar un pelo
// antes; sin margen, "anterior" contaría desde la línea previa y se saltaría una.
const LINE_EPSILON = 0.05;

// Salta al inicio de la línea japonesa anterior (-1), actual (0) o siguiente (1)
// y reproduce desde ahí.
function goToLine(step: -1 | 0 | 1) {
  const video = playerVideo();
  if (!state || !video) return;
  const t = video.currentTime;
  const current = lastStartedIndex(state.ja, t + LINE_EPSILON);
  // Entre dos líneas, "anterior" vuelve a la que acaba de terminar.
  const inGap = current >= 0 && state.ja[current].end <= t;
  const target = step === -1 && inGap ? current : current + step;
  if (target < 0 || target >= state.ja.length) return;
  video.currentTime = state.ja[target].start;
  if (video.paused) video.play().catch(() => {});
}

function applySettings() {
  overlay.hidden = !settings.enabled;
  // inject.js (mundo MAIN) no tiene chrome.storage: lee el estado de este atributo.
  document.documentElement.dataset.japanrefactor = settings.enabled ? "on" : "off";
  esLine.hidden = !settings.showEs;
  esButton.setAttribute("aria-pressed", String(settings.showEs));
  overlay.style.setProperty("--ytj-bg-opacity", String(settings.bgOpacity));
  overlay.style.setProperty("--ytj-font-scale", String(settings.fontScale));
  controls.setEnabled(settings.enabled);
  controls.setBgOpacity(settings.bgOpacity);
  controls.setFontScale(settings.fontScale);
  controls.setPauseOnHover(settings.pauseOnHover);
}

function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  applySettings();
  void chrome.storage.local.set(patch);
}

function currentVideoId(): string | null {
  return new URL(location.href).searchParams.get("v");
}

// YouTube aplica Trusted Types: se arma el DOM con nodos, sin innerHTML.
function segmentNode(seg: Segment): Node {
  if (!seg.reading) return document.createTextNode(seg.text);
  const ruby = document.createElement("ruby");
  const rt = document.createElement("rt");
  rt.textContent = seg.reading;
  ruby.append(seg.text, rt);
  return ruby;
}

// Palabras de la línea japonesa con el instante en que se dicen (solo automáticos).
let timedTokens: { el: HTMLElement; t: number }[] = [];
let shownSaid = -1;

function spokenAt(words: NonNullable<Cue["words"]>, at: number): number {
  let t = words[0].t;
  for (const w of words) {
    if (w.at > at) break;
    t = w.t;
  }
  return t;
}

// Línea japonesa dibujada, con sus expresiones (las de JMdict y las frases
// guardadas), y las frases guardadas con que se dibujó.
let shown: { line: AnalyzedLine; spans: Span[] } | null = null;
let shownPhrases = "";

function phraseSignature(): string {
  return [...savedKeys()]
    .filter((k) => k.startsWith("p:"))
    .sort()
    .join("\n");
}

// Cada unidad va en un span (para la selección y para aparecer al decirse); las
// que se pueden marcar llevan además su clave. Las expresiones las agrupan.
function renderLine(line: AnalyzedLine, words?: Cue["words"]) {
  timedTokens = [];
  shownSaid = -1;
  const spans = combineSpans(findPhrases(line.units, savedKeys()), line.expressions);
  shown = { line, spans };
  shownPhrases = phraseSignature();
  let at = 0;
  const unitEls = line.units.map((unit, i) => {
    const el = document.createElement("span");
    el.className = "ytj-unit";
    el.dataset.i = String(i);
    if (unit.key) {
      el.classList.add("ytj-word");
      el.dataset.word = unit.key;
    }
    el.append(...unit.segments.map(segmentNode));
    if (words?.length) timedTokens.push({ el, t: spokenAt(words, at) });
    at += unit.text.length;
    return el;
  });
  const nodes: Node[] = [];
  for (let i = 0; i < unitEls.length; ) {
    const expression = spans.find((s) => s.start === i);
    if (!expression) {
      nodes.push(unitEls[i++]);
      continue;
    }
    const group = document.createElement("span");
    group.className = "ytj-expr";
    group.dataset.key = expression.key;
    group.append(...unitEls.slice(expression.start, expression.end));
    nodes.push(group);
    i = expression.end;
  }
  jaLine.replaceChildren(...nodes);
  refreshWordColors();
}

// Como YouTube con los automáticos: cada palabra aparece cuando se dice. Las
// que faltan conservan su sitio para que el texto no se mueva bajo el cursor.
function revealSaid(t: number) {
  let said = 0;
  while (said < timedTokens.length && timedTokens[said].t <= t) said++;
  if (said === shownSaid) return;
  shownSaid = said;
  timedTokens.forEach(({ el }, i) => el.classList.toggle("ytj-unsaid", i >= said));
}

function setStatusClasses(el: HTMLElement, prefix: string, status: WordStatus) {
  el.classList.toggle(`${prefix}known`, status === "known");
  el.classList.toggle(`${prefix}learning`, status === "learning");
  el.classList.toggle(`${prefix}unknown`, status === "unknown");
}

// Desconocidas en morado, para aprender en naranja; las palabras de una
// expresión conocida cuentan como conocidas. Se actualiza sin redibujar para
// no perder la selección.
function refreshWordColors() {
  for (const expression of jaLine.querySelectorAll<HTMLElement>(".ytj-expr")) {
    setStatusClasses(expression, "ytj-expr-", statusOf(expression.dataset.key!));
  }
  for (const word of jaLine.querySelectorAll<HTMLElement>(".ytj-word")) {
    setStatusClasses(word, "ytj-", word.closest(".ytj-expr-known") ? "known" : statusOf(word.dataset.word!));
  }
}

onKnownWordsChange(() => {
  // Una frase nueva cambia cómo se agrupan las unidades: hay que redibujar.
  if (phraseSignature() !== shownPhrases) shownJa = -2;
  else refreshWordColors();
  updatePhraseBar();
  const counts = statusCounts();
  controls.setCounts(counts.known, counts.learning);
});

function showStatus(message: string) {
  jaLine.textContent = message;
  esLine.textContent = "";
  shownJa = shownEs = -2;
  setTimeout(() => {
    if (!state && jaLine.textContent === message) jaLine.textContent = "";
  }, 5000);
}

function attachOverlay(): HTMLVideoElement | null {
  const player = document.getElementById("movie_player");
  const video = player?.querySelector<HTMLVideoElement>("video.html5-main-video");
  if (!player || !video) return null;
  if (overlay.parentElement !== player) player.append(overlay);
  const cc = player.querySelector(".ytp-subtitles-button");
  if (cc?.parentElement && esButton.nextElementSibling !== cc) cc.parentElement.insertBefore(esButton, cc);
  controls.attach(player);
  nav.attach(player);
  player.classList.toggle("ytj-active", settings.enabled && state !== null);
  return video;
}

// Ratón sobre los subtítulos: se entra al moverlo sobre el texto y se sale al
// alejarse más de HOVER_MARGIN, que cubre el hueco entre las líneas y el que
// deja Yomitan hasta su ventana. Dentro de esa ventana (un iframe) esta página
// no recibe mousemove, así que se sigue "encima" hasta que el ratón vuelve.
const HOVER_MARGIN = 10;
let overSubs = false;
let hoverPaused: HTMLVideoElement | null = null;

function nearSubs(x: number, y: number): boolean {
  return [jaLine, esLine].some((line) => {
    const r = line.getBoundingClientRect();
    return (
      r.width > 0 &&
      x > r.left - HOVER_MARGIN &&
      x < r.right + HOVER_MARGIN &&
      y > r.top - HOVER_MARGIN &&
      y < r.bottom + HOVER_MARGIN
    );
  });
}

// Solo se entra con los controles visibles y el texto quieto. Si estaban
// ocultos, este mismo movimiento los muestra y el texto sube: congelarlo antes
// lo dejaría tapando la barra, y esperar evita que se mueva bajo el cursor.
function subsSettled(): boolean {
  const player = overlay.parentElement;
  return !!player && !player.classList.contains("ytp-autohide") && overlay.getAnimations().length === 0;
}

// Como en Language Reactor: pausa mientras el ratón está encima y reanuda al
// salir, solo si la pausa la puso la extensión.
function pauseForHover() {
  const video = playerVideo();
  if (!settings.pauseOnHover || !state || !video || video.paused) return;
  video.pause();
  hoverPaused = video;
}

function resumeAfterHover() {
  const video = hoverPaused;
  hoverPaused = null;
  if (video?.paused) video.play().catch(() => {});
}

document.addEventListener(
  "mousemove",
  (e) => {
    const target = e.target as Node;
    const onText =
      (jaLine.contains(target) || esLine.contains(target) || phraseBar.contains(target)) &&
      (overSubs || subsSettled());
    if (onText === overSubs || (!onText && nearSubs(e.clientX, e.clientY))) return;
    overSubs = onText;
    // La posición sube cuando aparecen los controles; con el ratón encima se
    // congela para que el texto no se mueva bajo el cursor al seleccionar.
    overlay.style.bottom = overSubs ? getComputedStyle(overlay).bottom : "";
    if (overSubs) pauseForHover();
    else resumeAfterHover();
  },
  { capture: true, passive: true },
);

// Si el usuario le da a reproducir con el ratón encima, la pausa ya no es nuestra.
document.addEventListener(
  "play",
  (e) => {
    if (e.target === hoverPaused) hoverPaused = null;
  },
  true,
);

// Al recargar o actualizar la extensión, este script queda huérfano: pierde su
// CSS pero sigue corriendo, y su texto quedaría sin estilo arriba del video.
// Se retira y deja de dibujar; la pestaña necesita recargarse para la versión nueva.
function isOrphaned(): boolean {
  return !chrome.runtime?.id;
}

function destroy() {
  overlay.remove();
  esButton.remove();
  controls.destroy();
  nav.destroy();
  phraseBar.remove();
  document.getElementById("movie_player")?.classList.remove("ytj-active");
}

function tick() {
  if (isOrphaned()) {
    destroy();
    return;
  }
  requestAnimationFrame(tick);
  const video = attachOverlay();
  if (!video || !state) return;
  if (state.videoId !== currentVideoId()) {
    clear();
    return;
  }

  const t = video.currentTime;
  const jaIdx = activeCueIndex(state.ja, t);
  if (jaIdx !== shownJa) {
    shownJa = jaIdx;
    timedTokens = [];
    shown = null;
    const line = jaIdx >= 0 ? state.jaLines[jaIdx] : undefined;
    if (jaIdx < 0) jaLine.textContent = "";
    else if (line) renderLine(line, state.ja[jaIdx].words);
    else {
      jaLine.textContent = state.ja[jaIdx].text;
      shownJa = -2; // volver a dibujar cuando el furigana esté listo
    }
  }
  revealSaid(t);
  const esIdx = activeCueIndex(state.es, t);
  if (esIdx !== shownEs) {
    shownEs = esIdx;
    esLine.textContent = esIdx >= 0 ? state.es[esIdx].text : "";
  }
}

function clear() {
  state = null;
  shownJa = shownEs = -2;
  jaLine.textContent = "";
  esLine.textContent = "";
  document.getElementById("movie_player")?.classList.remove("ytj-active");
}

async function onSubs(videoId: string, ja: Cue[], es: Cue[]) {
  if (videoId !== currentVideoId()) return;
  const current: State = { videoId, ja, es, jaLines: [] };
  state = current;
  shownJa = shownEs = -2;
  try {
    const [tokenizer, dict] = await Promise.all([getTokenizer(), loadDictionary()]);
    if (state !== current) return;
    current.jaLines = ja.map((cue) => analyzeLine(tokenizer.tokenize(cue.text), dict));
  } catch (err) {
    console.error("[JapanRefactor] no se pudo cargar el diccionario de furigana", err);
  }
}

// Sin JMdict la extensión sigue funcionando, con las palabras como las corta kuromoji.
function loadDictionary(): Promise<Dictionary | null> {
  return getDictionary().catch((err) => {
    console.error("[JapanRefactor] no se pudo cargar JMdict", err);
    return null;
  });
}

window.addEventListener("message", (event) => {
  const data = event.data as BridgeMessage | undefined;
  if (event.source !== window || data?.source !== MSG_SOURCE) return;
  if (data.type === "subs") void onSubs(data.videoId, data.ja, data.es);
  else if (data.type === "status" && data.videoId === currentVideoId()) {
    clear();
    showStatus(data.message);
  }
});

window.addEventListener("yt-navigate-finish", () => {
  if (state && state.videoId !== currentVideoId()) clear();
});

applySettings();
void chrome.storage.local.get(DEFAULT_SETTINGS).then((saved) => {
  Object.assign(settings, saved);
  applySettings();
});

// Por si inject.js ya recibió los subtítulos antes de que este script escuchara.
window.postMessage({ source: MSG_SOURCE, type: "resend" } satisfies BridgeMessage, location.origin);
void getTokenizer().catch(() => {});
// Las palabras marcadas antes de usar JMdict se guardaban por su forma de diccionario.
void loadDictionary().then(
  (dict) =>
    dict &&
    migrateKnownWords((word) => {
      const entry = bestEntry(dict.lookup(word));
      return entry ? "j" + entry.id : word;
    }),
);
requestAnimationFrame(tick);
