import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // @boq/shared ships as TypeScript source, so bundle it into the output.
  noExternal: ['@boq/shared'],
});
