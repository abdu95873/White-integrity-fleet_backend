import { ZodError } from "zod";

export function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation failed", details: err.errors });
      }
      next(err);
    }
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.validatedQuery = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation failed", details: err.errors });
      }
      next(err);
    }
  };
}
