/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      colors: {
        bgdark: "#07060f",
        panel: "#0d0c18",
        cardpanel: "#0f0e1c",
        borderpurple: "#232134",
      },
      boxShadow: {
        "glow-purple": "0 0 80px 10px rgba(139,92,246,0.35)",
      },
    },
  },
  plugins: [],
};
