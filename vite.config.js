import { defineConfig } from 'vite';

// Use relative asset URLs so the app works at both / and /<repository>/ on static hosts.
export default defineConfig({
  base: './'
});
