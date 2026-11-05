/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#101828',
        mint: '#b8f5d0',
        canvas: '#f5f7f4',
      },
      boxShadow: {
        card: '0 18px 50px rgba(16, 24, 40, 0.08)',
      },
    },
  },
  plugins: [],
};
