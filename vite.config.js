import { defineConfig, createLogger } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Suppress the "can't be bundled without type=module" warning for the
// assets/*.js files.  These are intentional classic IIFE scripts served
// directly through the Cloudflare ASSETS binding — they are NOT Vite-bundled
// ES modules.  Vite 8 warns about them at build time but the warning is a
// false positive: the scripts work correctly in all browsers as-is.
const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, opts) => {
  // Filter warnings that mention both "bundled" and 'type="module"' — this
  // covers the "can't be bundled without type=\"module\" attribute" family of
  // messages across Vite versions without requiring an exact string match.
  if (msg.includes('bundled') && msg.includes('type="module"')) return;
  originalWarn(msg, opts);
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
      },
    },
  },
});
