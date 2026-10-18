import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.ts";
import { get } from "../db.ts";
import { HttpError } from "./http.ts";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashPassword = (pw: string) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compareSync(pw, hash);

export const signToken = (u: AuthUser) =>
  jwt.sign({ sub: String(u.id), role: u.role }, config.jwtSecret, { expiresIn: config.jwtTtl as any });

/** Verifies the bearer token and re-reads the user so deactivation/role changes take effect immediately. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HttpError(401, "Authentication required");
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  const user = get<AuthUser & { active: number }>(
    "SELECT id, email, name, role, active FROM users WHERE id = ?",
    Number(payload.sub),
  );
  if (!user || !user.active) throw new HttpError(401, "Account unavailable");
  req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") throw new HttpError(403, "Admin access required");
  next();
}

export const uid = (req: Request) => req.user!.id;
