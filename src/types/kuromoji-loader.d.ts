declare module "kuromoji/src/loader/BrowserDictionaryLoader.js" {
  const BrowserDictionaryLoader: {
    prototype: {
      loadArrayBuffer(url: string, callback: (err: unknown, buffer: ArrayBuffer | null) => void): void;
    };
  };
  export default BrowserDictionaryLoader;
}
