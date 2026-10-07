import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Preload only the Latin font files (R17-m3); other alphabets load if a page ever needs them. */
function preloadLatinFonts(): Plugin {
  return {
    name: 'rigo-preload-latin-fonts',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      const fonts = Object.keys(ctx.bundle).filter((f) => /geist(-mono)?-latin-wght-normal[^/]*\.woff2$/.test(f));
      return { html, tags: fonts.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' }, injectTo: 'head' as const })) };
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadLatinFonts()],
  root: 'src/client',
  publicDir: '../../static',
  build: { outDir: '../../dist', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
