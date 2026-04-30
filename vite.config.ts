import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
    host: '0.0.0.0',
    hmr: {
        clientPort: 4443
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
