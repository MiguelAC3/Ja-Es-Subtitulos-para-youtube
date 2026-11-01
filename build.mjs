import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/content/content.css", "dist/content.css");
cpSync("icons", "dist/icons", { recursive: true });
cpSync("node_modules/kuromoji/dict", "dist/dict", { recursive: true });
// Generado con scripts/build-jmdict.mjs.
cpSync("data/jmdict.tsv.gz", "dist/jmdict.tsv.gz");

await build({
  entryPoints: { content: "src/content/index.ts", inject: "src/inject/index.ts" },
  bundle: true,
  outdir: "dist",
  target: "chrome120",
  sourcemap: true,
  alias: { path: "./src/shims/path.ts" },
});

console.log("Compilado en dist/");
