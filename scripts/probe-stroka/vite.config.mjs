import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const тут = path.dirname(new URL(import.meta.url).pathname);
export default defineConfig({
  root: тут,
  base: "./",
  plugins: [react()],
  define: { __BUILD_TIME__: JSON.stringify("проба") },
  build: {
    outDir: path.join(тут, "__dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
  },
});
