const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const ctx = esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: false,
  sourcemap: true,
  sourcesContent: false,
  platform: 'node',
  outfile: 'out/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
});

ctx.then(async (c) => {
  if (watch) {
    await c.watch();
    console.log('[watch] build finished, watching for changes...');
  } else {
    await c.rebuild();
    await c.dispose();
    console.log('[build] build finished');
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
