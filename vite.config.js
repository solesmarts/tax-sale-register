import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base must match your repo name for GitHub Pages project sites
// (github.com/<user>/tax-sale-register -> served at /tax-sale-register/)
export default defineConfig({
  plugins: [react()],
  base: '/tax-sale-register/',
})
