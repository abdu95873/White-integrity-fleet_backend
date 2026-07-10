const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function isAllowedOrigin(origin) {
  if (!origin) return true;

  const allowed = new Set([FRONTEND_URL, ...EXTRA_ORIGINS]);
  if (allowed.has(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith(".vercel.app") || hostname === "localhost";
  } catch {
    return false;
  }
}

export function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
}

export const corsOptions = {
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, origin || true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
