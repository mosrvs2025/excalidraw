import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAi } from "./_core";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "anon").split(",")[0].trim();
  const out = await handleAi({ method: req.method ?? "GET", body: req.body, ip, env: process.env });
  res.status(out.status).json(out.json);
}
