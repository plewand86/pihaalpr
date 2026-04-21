import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1c1c1c',
        panel: '#282828',
      },
    },
  },
  plugins: [],
} satisfies Config
