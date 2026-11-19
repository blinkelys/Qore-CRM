import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: { '/api': { target: 'http://localhost:3000' } },
  },
  test: { environment: 'jsdom' },
});
