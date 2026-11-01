// Corre en el mundo MAIN de la página (document_start) para ver las peticiones
// del reproductor. YouTube exige un token "pot" en /api/timedtext; solo el
// reproductor lo genera, así que reutilizamos el de su propia petición.
import { MSG_SOURCE, parseJson3, type BridgeMessage } from "../shared/captions";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

interface PlayerResponse {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

interface YtPlayer extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse | undefined;
}

// Parámetros de la petición del reproductor que hay que copiar a las nuestras.
const COPIED_PARAMS = ["pot", "potc", "c", "cver", "cplayer", "cos", "cosver", "cplatform", "xorb", "xobt", "xovt"];

const originalFetch = window.fetch.bind(window);
let handledVideoId = "";
let lastMessage: BridgeMessage | null = null;

function log(...args: unknown[]) {
  console.info("[JapanRefactor]", ...args);
}

function post(msg: BridgeMessage) {
  if (msg.type !== "resend") lastMessage = msg;
  window.postMessage(msg, location.origin);
}

function currentVideoId(): string | null {
  return new URL(location.href).searchParams.get("v");
}

function getTracks(videoId: string): CaptionTrack[] {
  const player = document.getElementById("movie_player") as YtPlayer | null;
  const candidates: (PlayerResponse | undefined)[] = [
    player?.getPlayerResponse?.(),
    (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse,
  ];
  for (const resp of candidates) {
    if (resp?.videoDetails?.videoId !== videoId) continue;
    return resp.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  }
  return [];
}

// Tras una navegación SPA el reproductor puede pedir subtítulos antes de que
// getPlayerResponse() refleje el video nuevo.
async function waitForTracks(videoId: string): Promise<CaptionTrack[]> {
  for (let i = 0; i < 15; i++) {
    const tracks = getTracks(videoId);
    if (tracks.length > 0) return tracks;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return [];
}

function buildUrl(track: CaptionTrack, playerUrl: URL, tlang?: string): string {
  const url = new URL(track.baseUrl, location.origin);
  for (const key of COPIED_PARAMS) {
    const value = playerUrl.searchParams.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set("fmt", "json3");
  if (tlang) url.searchParams.set("tlang", tlang);
  else url.searchParams.delete("tlang");
  return url.toString();
}

async function fetchCues(url: string) {
  const res = await originalFetch(url, { credentials: "include" });
  const body = await res.text();
  if (!res.ok || !body) throw new Error(`timedtext ${res.status} vacío`);
  return parseJson3(JSON.parse(body));
}

async function onPlayerTimedtext(rawUrl: string) {
  const playerUrl = new URL(rawUrl, location.origin);
  const videoId = playerUrl.searchParams.get("v");
  log("petición de subtítulos del reproductor", { videoId, pot: playerUrl.searchParams.has("pot") });
  if (!playerUrl.searchParams.get("pot") || !videoId) return;
  if (videoId === handledVideoId || videoId !== currentVideoId()) return;
  handledVideoId = videoId;

  const tracks = await waitForTracks(videoId);
  log("pistas disponibles", tracks.map((t) => `${t.languageCode}${t.kind === "asr" ? " (auto)" : ""}`));
  const ja =
    tracks.find((t) => t.languageCode.startsWith("ja") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode.startsWith("ja"));
  if (!ja) {
    post({ source: MSG_SOURCE, type: "status", videoId, message: "Este video no tiene subtítulos en japonés" });
    return;
  }
  const es = tracks.find((t) => t.languageCode.startsWith("es") && t.kind !== "asr");

  try {
    const [jaCues, esCues] = await Promise.all([
      fetchCues(buildUrl(ja, playerUrl)),
      // YouTube a veces responde vacío a la traducción; el japonés se muestra igual.
      fetchCues(es ? buildUrl(es, playerUrl) : buildUrl(ja, playerUrl, "es")).catch((err) => {
        log("sin subtítulos en español", err);
        return [];
      }),
    ]);
    log("subtítulos cargados", { ja: jaCues.length, es: esCues.length });
    post({ source: MSG_SOURCE, type: "subs", videoId, ja: jaCues, es: esCues });
  } catch (err) {
    handledVideoId = "";
    log("error cargando subtítulos", err);
    post({ source: MSG_SOURCE, type: "status", videoId, message: `Error cargando subtítulos: ${String(err)}` });
  }
}

function isTimedtext(url: string): boolean {
  return url.includes("/api/timedtext");
}

const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  const href = String(url);
  if (isTimedtext(href)) void onPlayerTimedtext(href);
  return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const href = input instanceof Request ? input.url : String(input);
  if (isTimedtext(href)) void onPlayerTimedtext(href);
  return originalFetch(input, init);
};

// El content script marca <html data-japanrefactor="off"> cuando se apaga el interruptor.
function isEnabled(): boolean {
  return document.documentElement.dataset.japanrefactor !== "off";
}

// El reproductor solo pide subtítulos con CC activado: lo activamos si el video
// tiene pista en japonés. Durante un anuncio el clic activaría los subtítulos
// del anuncio y no los del video, así que se espera a que termine; si CC sigue
// apagado se reintenta. Los subtítulos nativos se ocultan por CSS.
let captionsClickedFor = "";
let captionsClickedAt = 0;
setInterval(() => {
  const videoId = currentVideoId();
  const player = document.getElementById("movie_player");
  const button = player?.querySelector<HTMLButtonElement>(".ytp-subtitles-button");
  if (!videoId || !player || !button) return;
  if (!isEnabled()) {
    // Al apagar JapanRefactor se apaga también el CC que activamos nosotros.
    if (videoId === captionsClickedFor && button.getAttribute("aria-pressed") === "true") {
      captionsClickedFor = "";
      log("apagado: desactivando CC");
      button.click();
    }
    return;
  }
  if (videoId === handledVideoId) return;
  if (videoId === captionsClickedFor && Date.now() - captionsClickedAt < 5000) return;
  if (player.classList.contains("ad-showing")) return;
  if (button.getAttribute("aria-pressed") !== "false") return;
  if (!getTracks(videoId).some((t) => t.languageCode.startsWith("ja"))) return;
  captionsClickedFor = videoId;
  captionsClickedAt = Date.now();
  log("activando CC para obtener el token de subtítulos");
  button.click();
}, 1000);

window.addEventListener("message", (event) => {
  const data = event.data as BridgeMessage | undefined;
  if (event.source !== window || data?.source !== MSG_SOURCE || data.type !== "resend") return;
  if (lastMessage && "videoId" in lastMessage && lastMessage.videoId === currentVideoId()) {
    post(lastMessage);
  }
});
