import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: '每日账本',
        short_name: '每日账本',
        description: '离线、私密的个人收支账本',
        theme_color: '#0b1220',
        background_color: '#f4f7fb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './#/home',
        scope: './',
        lang: 'zh-CN',
        icons: [
          { src: './apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ],
        shortcuts: [
          { name: '快速记账', short_name: '记一笔', url: './#/add', icons: [{ src: './icon-512.png', sizes: '512x512', type: 'image/png' }] }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@tesseract\.js-data\//,
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-language-data', expiration: { maxEntries: 8, maxAgeSeconds: 31536000 } }
          }
        ]
      }
    })
  ],
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] }
})
