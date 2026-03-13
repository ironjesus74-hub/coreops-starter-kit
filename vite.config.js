import { defineConfig, createLogger } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Suppress Vite 8 warnings for intentional classic (IIFE) scripts that are
// served directly via the Cloudflare ASSETS binding — not bundled by Vite.
const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  if (msg.includes("can't be bundled") && msg.includes('type="module"')) return;
  originalWarn(msg, options);
};

export default defineConfig({
  customLogger: logger,
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
        operator: resolve(__dirname, 'operator.html'),
      },
    },
  },
});
