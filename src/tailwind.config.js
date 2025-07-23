/** @type {import('tailwindcss').Config} */
module.exports = {
  // This array tells Tailwind where to look for your CSS classes (like bg-gray-900).
  // It's essential for Tailwind to generate the correct CSS.
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  // The 'theme' section is where you can extend Tailwind's default colors, fonts, spacing, etc.
  theme: {
    extend: {
      // If you still want to define your custom background image as a Tailwind class,
      // you would add it here like:
      // backgroundImage: {
      //   'my-custom-bg': "url('/new-background.jpg')",
      // },
      // But for a reliable dark mode, we're using a gradient in App.js directly.
    },
  },
  // Plugins can add extra functionality to Tailwind.
  plugins: [],
  // You could add 'darkMode: 'media'' or 'darkMode: 'class'' here
  // if you wanted to enable automatic dark mode based on user's OS settings
  // or a manual toggle. However, for a hardcoded dark mode (always dark),
  // this setting isn't strictly necessary as the classes are always present.
}