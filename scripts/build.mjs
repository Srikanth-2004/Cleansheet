import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist/api', { recursive: true });
await build({
  entryPoints: ['src/lambda.ts'],
  outfile: 'dist/api/lambda.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
});
await writeFile('dist/api/package.json', '{"type":"commonjs"}\n');
