import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: 'corteza-runtime-config',
      transformIndexHtml: {
        order: 'post',
        handler: () => [
          {
            tag: 'script',
            attrs: { src: '/tickets/config.js' },
            injectTo: 'head-prepend',
          },
        ],
      },
    },
  ],
  base: '/tickets/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:18080',
      '/auth': 'http://localhost:18080',
      '/tickets/config.js': 'http://localhost:18080',
    },
  },
})
