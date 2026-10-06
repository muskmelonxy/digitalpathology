/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Figtree', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      colors: {
        ink: '#1c1915',
        paper: '#f3efe6',
        stain: {
          50: '#f2f8f6',
          100: '#e0f0ec',
          600: '#1f6f68',
          700: '#185850',
          800: '#123f3b',
        },
        clay: '#e7a15a',
        primary: {
          50: '#f2f8f6',
          100: '#e0f0ec',
          200: '#c5e2db',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#1f6f68',
          600: '#185850',
          700: '#123f3b',
          800: '#123f3b',
          900: '#0d2c29',
        }
      }
    },
  },
  plugins: [],
}
