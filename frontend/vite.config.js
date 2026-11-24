import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies the API to a running cluster (or local services).
const target = process.env.CAP_API || 'http://127.0.0.1:18081';
const presenter = process.env.CAP_PRESENTER || 'http://127.0.0.1:18083';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/compliance': { target: presenter, changeOrigin: false },
      '/api': { target, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
