import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export function signToken(payload) {
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
