// Bundles the app UI with esbuild (already installed for Remotion). Usage: node app/build.mjs [--watch]
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, 'web');
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
// theme: --theme <name> > studio.config.json "appTheme" > astryx. Themes live in app/web/src/themes/<name>.css
const cfg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'studio.config.json'), 'utf8'));
const ti = process.argv.indexOf('--theme');
const theme = (ti > 0 && process.argv[ti + 1]) || cfg.appTheme || 'astryx';
fs.copyFileSync(path.join(dir, 'src', 'themes', `${theme}.css`), path.join(dir, 'dist', 'app.css'));
console.log('theme:', theme);
const opts = {
  entryPoints: [path.join(dir, 'src', 'main.tsx')], bundle: true, outfile: path.join(dir, 'dist', 'app.js'),
  jsx: 'automatic', target: 'es2022', minify: !process.argv.includes('--watch'), sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
};
if (process.argv.includes('--watch')) { const ctx = await esbuild.context(opts); await ctx.watch(); console.log('watching app/web/src'); }
else { const r = await esbuild.build(opts); console.log('built app/web/dist/app.js', r.errors.length ? r.errors : ''); }
