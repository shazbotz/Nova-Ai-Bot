import crypto from "crypto";
import { config } from "../config";

// Constant-time string comparison for HMAC signatures. A plain `!==` compare
// short-circuits on the first differing character, which in principle leaks
// timing information about how much of the signature an attacker has
// guessed correctly. Buffers of unequal length are treated as a mismatch
// without ever calling timingSafeEqual (which requires equal lengths).
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Telegram initData verification ────────────────────────────────────────────
export function verifyTelegramInitData(initData: string): { userId: number; username?: string; firstName?: string } | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(config.telegram.token)
      .digest();
    const expectedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (!safeCompare(expectedHash, hash)) return null;

    const userStr = params.get("user");
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    if (typeof user.id !== "number") return null;

    return {
      userId: user.id,
      username: user.username,
      firstName: user.first_name,
    };
  } catch {
    return null;
  }
}

// ── Simple session token (no external JWT library needed) ─────────────────────
export function createSessionToken(userId: number): string {
  const payload = `${userId}:${Date.now()}`;
  const sig = crypto
    .createHmac("sha256", config.telegram.token || "fallback-secret")
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifySessionToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    const payload = `${userId}:${ts}`;
    const expected = crypto
      .createHmac("sha256", config.telegram.token || "fallback-secret")
      .update(payload)
      .digest("hex");
    if (!safeCompare(expected, sig)) return null;
    // Token expires in 30 days
    if (Date.now() - parseInt(ts) > 30 * 24 * 60 * 60 * 1000) return null;
    return parseInt(userId);
  } catch {
    return null;
  }
}

// ── Express middleware ─────────────────────────────────────────────────────────
import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const userId = verifySessionToken(token);
  if (!userId) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as Request & { userId: number }).userId = userId;
  next();
}
