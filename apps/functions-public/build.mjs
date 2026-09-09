import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  external: [
    // Must remain external: shared singleton with the Azure Functions worker
    '@azure/functions',
    // Optional native metrics peer dep — not installed, mark external
    'applicationinsights-native-metrics',
  ],
  logLevel: 'info',
});
