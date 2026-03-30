/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: '#0f0f0f',
        panel:   '#1a1a1a',
        border:  '#2a2a2a',
        muted:   '#6b7280',
        accent:  '#3b82f6',
      },
    },
  },
  plugins: [],
};
