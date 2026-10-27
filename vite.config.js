import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// - @tailwindcss/vite was missing in the original config: Tailwind v4's
//   `@import "tailwindcss"` in index.css needs this plugin to compile in build.
// - The dev proxy lets the frontend call /api without CORS or a hard-coded
//   localhost URL during development. Production uses VITE_API_URL.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  esbuild: { jsx: 'automatic' },
  build: {
    // Split long-lived vendor code into its own chunks: they are cached
    // across deploys and no single chunk trips the size warning. Page-level
    // splitting comes from React.lazy in App.jsx / Dashboard.jsx.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-utils': ['axios', 'xlsx'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
