/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    port: 4173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('epubjs')) return 'vendor-epub';
          if (id.includes('pdfjs-dist')) return 'vendor-pdf';
          if (id.includes('marked') || id.includes('dompurify')) return 'vendor-parser';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
})
