// kuromoji usa path.join para armar las URLs del diccionario. El shim de
// navegador normal colapsa "chrome-extension://" a "chrome-extension:/".
export function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .join("/");
}

export default { join };
