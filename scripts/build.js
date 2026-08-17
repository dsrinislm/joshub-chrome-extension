import { build } from "esbuild";
import { minify as minifyHTML } from "html-minifier-terser";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

// Clean dist/
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Bundle + minify JS with code splitting
await build({
  entryPoints: [join(ROOT, "popup.js")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "esnext",
  outdir: DIST,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  sourcemap: false,
  logLevel: "warning",
});

// Minify CSS via esbuild
const cssResult = await build({
  entryPoints: [join(ROOT, "popup.css")],
  bundle: true,
  minify: true,
  write: false,
  logLevel: "warning",
});
writeFileSync(join(DIST, "popup.css"), cssResult.outputFiles[0].text);

// Minify JSON
const manifest = readFileSync(join(ROOT, "manifest.json"), "utf8");
writeFileSync(join(DIST, "manifest.json"), JSON.stringify(JSON.parse(manifest)));

// Transform + minify popup.html
let html = readFileSync(join(ROOT, "popup.html"), "utf8");
// Remove the jira-adf.js script tag (now bundled into popup.js)
html = html.replace(/\s*<script src="libraries\/jira-adf\.js"><\/script>\n?/, "\n");

const minifiedHTML = await minifyHTML(html, {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  minifyCSS: true,
});
writeFileSync(join(DIST, "popup.html"), minifiedHTML);

// Copy icons (binary — no minification)
mkdirSync(join(DIST, "icons"), { recursive: true });
const { cpSync } = await import("node:fs");
cpSync(join(ROOT, "icons"), join(DIST, "icons"), { recursive: true });

console.log(`\nBuild complete → ${relative(ROOT, DIST)}/`);
