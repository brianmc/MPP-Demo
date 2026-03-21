import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/proxy/ping/paid': {
        target: 'https://mpp.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace('/proxy/ping/paid', '/api/ping/paid'),
      },
    },
  },
})
