import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 注意：东方财富与 Alpha Vantage 在浏览器里通常都允许跨域调用，
// 但部分线路或浏览器扩展可能干扰。下面的 proxy 仅在本地 dev 环境使用，
// 生产环境（npm run build + nginx）下 fetch 直接走浏览器到对应域名。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
