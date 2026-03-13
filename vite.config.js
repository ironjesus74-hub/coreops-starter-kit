import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        prompts:  resolve(__dirname, 'prompts.html'),
        gauntlet: resolve(__dirname, 'gauntlet.html'),
        market:   resolve(__dirname, 'market.html'),
        forum:    resolve(__dirname, 'forum.html'),
        debate:   resolve(__dirname, 'debate.html'),
        profile:  resolve(__dirname, 'profile.html'),
      },
    },
  },
});
