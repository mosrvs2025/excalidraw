import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { handleAi } from "./api/_core.ts";

/** Serve /api/ai in `vite dev` and `vite preview` exactly like the Vercel function does. */
const devApi = (mode: string) => {
  const env = loadEnv(mode, process.cwd(), "");
  const mw = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith("/api/ai")) return next();
    let raw = "";
    for await (const c of req) raw += c;
    let body: any;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const out = await handleAi({ method: req.method, body, ip: req.socket?.remoteAddress ?? "dev", env: { ...env, ...process.env } });
    res.statusCode = out.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out.json));
  };
  return {
    name: "lumen-dev-api",
    configureServer: (s: any) => void s.middlewares.use(mw),
    configurePreviewServer: (s: any) => void s.middlewares.use(mw),
  };
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), devApi(mode)],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { chunkSizeWarningLimit: 4000, sourcemap: false },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
  },
}));
