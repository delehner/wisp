const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extensionCtx = esbuild.context({
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

const webviewCtx = esbuild.context({
  entryPoints: ['media/chat.ts'],
  bundle: true,
  format: 'iife',
  minify: true,
  sourcemap: false,
  platform: 'browser',
  outfile: 'media/chat.js',
  external: [],
  logLevel: 'silent',
});

Promise.all([extensionCtx, webviewCtx]).then(async ([ext, webview]) => {
  if (watch) {
    await Promise.all([ext.watch(), webview.watch()]);
    console.log('[watch] build finished, watching for changes...');
  } else {
    await Promise.all([ext.rebuild(), webview.rebuild()]);
    await Promise.all([ext.dispose(), webview.dispose()]);
    console.log('[build] build finished');
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
