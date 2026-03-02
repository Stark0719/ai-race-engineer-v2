/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#080810',
        panel: '#0d0d18',
        panel2: '#131320',
        border: '#1a1a30',
        f1red: '#e10600',
        f1blue: '#2196F3',
        f1green: '#00c853',
        f1yellow: '#FFD700',
        f1cyan: '#00bcd4',
        f1orange: '#FF9800',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'SF Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
