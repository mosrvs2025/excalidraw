// Self-host Excalidraw's fonts so the app works offline / without third-party CDNs.
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
if (!existsSync(src)) process.exit(0);
mkdirSync("public", { recursive: true });
cpSync(src, "public/fonts", { recursive: true });
