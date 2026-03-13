import { defineConfig, createLogger } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The assets/*.js scripts are intentional IIFEs loaded as classic <script defer>
// (not ES modules) because they need no import graph and are served directly from
// the project root via the Cloudflare ASSETS binding without a build step.
// Vite 8 warns that it cannot bundle them; suppress that known-safe warning so
// build output stays clean while preserving all other Vite log levels.
const logger = createLogger();
const _loggerWarn = logger.warn.bind(logger);
logger.warn = (msg, opts) => {
  if (msg.includes("can't be bundled without type=\"module\" attribute")) return;
  _loggerWarn(msg, opts);
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
