import { defineConfig } from 'vite';

// No React plugin needed: Vite's built-in Oxc transform compiles JSX.
export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  server: {
    // During `npm run dev`, forward API calls to the Node server (`npm start`).
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
