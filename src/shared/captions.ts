export const MSG_SOURCE = "yt-japones";

export interface Cue {
  start: number;
  end: number;
  text: string;
  // Solo en subtítulos automáticos: cuándo se dice cada trozo (`at` = posición
  // en `text`). YouTube los muestra palabra a palabra, no la línea entera.
  words?: { at: number; t: number }[];
}

export type BridgeMessage =
  | { source: typeof MSG_SOURCE; type: "subs"; videoId: string; ja: Cue[]; es: Cue[] }
  | { source: typeof MSG_SOURCE; type: "status"; videoId: string; message: string }
  | { source: typeof MSG_SOURCE; type: "resend" };

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
}

// Formato fmt=json3 de /api/timedtext: { events: [{ tStartMs, dDurationMs, segs: [{ utf8, tOffsetMs }] }] }
// En los automáticos cada seg es una palabra y tOffsetMs indica cuándo se dice.
export function parseJson3(data: { events?: Json3Event[] }): Cue[] {
  const cues: Cue[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs) continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    let raw = "";
    const words: { at: number; t: number }[] = [];
    for (const seg of ev.segs) {
      words.push({ at: raw.length, t: start + (seg.tOffsetMs ?? 0) / 1000 });
      raw += (seg.utf8 ?? "").replace(/\s*\n\s*/g, " ");
    }
    const text = raw.trim();
    if (!text) continue;
    const cue: Cue = { start, end: start + (ev.dDurationMs ?? 0) / 1000, text };
    if (ev.segs.some((s) => s.tOffsetMs !== undefined)) {
      const lead = raw.length - raw.trimStart().length;
      cue.words = words.map((w) => ({ at: Math.max(0, w.at - lead), t: w.t }));
    }
    cues.push(cue);
  }
  return cues.sort((a, b) => a.start - b.start);
}

// Último cue que ya empezó en el instante t, haya terminado o no.
export function lastStartedIndex(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

// Último cue activo en el instante t (los de ASR se solapan; gana el más reciente).
export function activeCueIndex(cues: Cue[], t: number): number {
  const idx = lastStartedIndex(cues, t);
  for (let i = idx; i >= 0 && i > idx - 5; i--) {
    if (cues[i].end > t) return i;
  }
  return -1;
}
