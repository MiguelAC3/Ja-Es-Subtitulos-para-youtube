// Controles de JapanRefactor en el reproductor: interruptor ON/OFF junto al
// minutero, una tuerca que abre el panel de opciones y las flechas para
// moverse entre líneas de subtítulos.

export interface ControlsHandlers {
  onEnabledChange(enabled: boolean): void;
  onBgOpacityChange(opacity: number): void;
  onFontScaleChange(scale: number): void;
  onPauseOnHoverChange(enabled: boolean): void;
}

export interface SubtitleNavHandlers {
  onPrev(): void;
  onRepeat(): void;
  onNext(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Iconos "settings", "chevron_right", "refresh" y "chevron_left" de Material Icons (Apache 2.0).
const GEAR_PATH =
  "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z";
const NEXT_PATH = "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z";
const REPEAT_PATH =
  "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z";
const PREV_PATH = "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z";

const PLAYER_EVENTS = ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "touchstart", "touchend", "contextmenu"];

// Que el reproductor no reciba los eventos del elemento: así no pausa,
// no pasa a pantalla completa y el texto se puede seleccionar.
export function isolateFromPlayer(element: HTMLElement, extra: string[] = []) {
  for (const type of [...PLAYER_EVENTS, ...extra]) element.addEventListener(type, (e) => e.stopPropagation());
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function slider(label: string, min: number, max: number, step: number, onInput: (value: number) => void) {
  const row = el("label", "ytj-panel-row");
  const value = el("span", "ytj-panel-value");
  const input = el("input", "ytj-panel-slider");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const set = (v: number) => {
    input.value = String(v);
    value.textContent = `${v}%`;
  };
  input.addEventListener("input", () => {
    set(Number(input.value));
    onInput(Number(input.value));
  });
  row.append(el("span", "ytj-panel-label", label), value, input);
  return { row, set };
}

function checkbox(label: string, onChange: (checked: boolean) => void) {
  const row = el("label", "ytj-panel-row ytj-panel-check");
  const input = el("input", "ytj-panel-checkbox");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  row.append(el("span", "ytj-panel-label", label), input);
  return { row, set: (checked: boolean) => (input.checked = checked) };
}

export function createControls(handlers: ControlsHandlers) {
  const toggle = el("button", "ytp-button ytj-switch");
  toggle.setAttribute("role", "switch");
  toggle.title = "JapanRefactor";
  const stateText = el("span", "ytj-switch-text");
  const track = el("span", "ytj-switch-track");
  track.append(stateText, el("span", "ytj-switch-knob"));
  toggle.append(el("span", "ytj-logo", "あ"), track);
  toggle.addEventListener("click", () => handlers.onEnabledChange(toggle.getAttribute("aria-checked") !== "true"));

  const gear = el("button", "ytp-button ytj-gear");
  gear.title = "Opciones de JapanRefactor";
  gear.append(icon(GEAR_PATH));

  const group = el("div", "ytj-controls");
  group.append(toggle, gear);

  const opacity = slider("Opacidad del fondo", 0, 100, 5, (v) => handlers.onBgOpacityChange(v / 100));
  const fontSize = slider("Tamaño de letra", 50, 200, 10, (v) => handlers.onFontScaleChange(v / 100));
  const pauseOnHover = checkbox("Pausar con el ratón sobre los subtítulos", handlers.onPauseOnHoverChange);
  const panel = el("div", "ytj-panel");
  panel.hidden = true;
  const knownInfo = el("div", "ytj-panel-info");
  const hints = [
    "Clic: conocida (blanco). Clic derecho: para aprender (naranja). Otra vez: desconocida (morado).",
    "Alt+clic (o Alt+clic derecho) en una expresión subrayada, o selecciona varias palabras, para marcarla entera.",
  ].map((text) => el("div", "ytj-panel-hint", text));
  const credits = el("div", "ytj-panel-hint ytj-panel-credits", "Diccionario: JMdict (EDRDG, CC BY-SA 4.0)");
  panel.append(
    el("div", "ytj-panel-title", "JapanRefactor"),
    opacity.row,
    fontSize.row,
    pauseOnHover.row,
    knownInfo,
    ...hints,
    credits,
  );

  // El panel cuelga del reproductor (no de la barra) para que no lo recorte ni
  // se oculte con los controles; se coloca encima de la tuerca al abrirlo.
  function openPanel() {
    const player = panel.parentElement;
    if (!player) return;
    panel.hidden = false;
    const p = player.getBoundingClientRect();
    const g = gear.getBoundingClientRect();
    const left = Math.min(g.left - p.left, p.width - panel.offsetWidth - 8);
    panel.style.left = `${Math.max(8, left)}px`;
    panel.style.bottom = `${p.bottom - g.top + 8}px`;
  }
  gear.addEventListener("click", () => (panel.hidden ? openPanel() : (panel.hidden = true)));
  document.addEventListener(
    "mousedown",
    (e) => {
      const target = e.target as Node;
      if (!panel.hidden && !panel.contains(target) && !gear.contains(target)) panel.hidden = true;
    },
    true,
  );

  isolateFromPlayer(group);
  // keydown: que las flechas muevan el slider y no adelanten el video.
  isolateFromPlayer(panel, ["keydown"]);

  return {
    attach(player: HTMLElement) {
      const time = player.querySelector(".ytp-time-display");
      if (time && group.previousElementSibling !== time) time.after(group);
      if (panel.parentElement !== player) player.append(panel);
    },
    setEnabled(enabled: boolean) {
      toggle.setAttribute("aria-checked", String(enabled));
      stateText.textContent = enabled ? "ON" : "OFF";
    },
    setBgOpacity(value: number) {
      opacity.set(Math.round(value * 100));
    },
    setFontScale(value: number) {
      fontSize.set(Math.round(value * 100));
    },
    setPauseOnHover(enabled: boolean) {
      pauseOnHover.set(enabled);
    },
    setCounts(known: number, learning: number) {
      knownInfo.textContent = `Conocidas: ${known} · Para aprender: ${learning}`;
    },
    destroy() {
      group.remove();
      panel.remove();
    },
  };
}

// Flechas a la izquierda del video, como en Language Reactor: siguiente arriba,
// repetir en medio y anterior abajo.
export function createSubtitleNav(handlers: SubtitleNavHandlers) {
  const nav = el("div", "ytj-nav");
  const buttons: [string, string, () => void][] = [
    ["Línea siguiente", NEXT_PATH, handlers.onNext],
    ["Repetir línea", REPEAT_PATH, handlers.onRepeat],
    ["Línea anterior", PREV_PATH, handlers.onPrev],
  ];
  for (const [title, d, onClick] of buttons) {
    const button = el("button", "ytj-nav-button");
    button.title = title;
    button.append(icon(d));
    button.addEventListener("click", onClick);
    nav.append(button);
  }
  isolateFromPlayer(nav);
  // Sin foco tras el clic, para que la barra espaciadora siga pausando el video
  // en vez de volver a pulsar la flecha.
  nav.addEventListener("mousedown", (e) => e.preventDefault());

  return {
    attach(player: HTMLElement) {
      if (nav.parentElement !== player) player.append(nav);
    },
    destroy() {
      nav.remove();
    },
  };
}
