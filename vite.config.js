import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@local/thymio3-api': resolve(__dirname, 'vendor/thymio3-api/src/thymio.ts'),
    },
  },
  assetsInclude: ['**/*.py'],
  build: {
    target: 'esnext',
  },
});
