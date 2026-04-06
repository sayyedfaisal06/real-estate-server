// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../config/database";
import { env } from "../config";
import { AuthenticatedRequest } from "../types";
import { UserRole } from "../generated/prisma/client";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh if >1 day old
  },
});

// ─── Require authenticated session ──────────
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: req.headers as unknown as Headers,
    });
    if (!session?.user) {
      res.status(401).json({ success: false, error: "Unauthorised" });
      return;
    }

    // Attach full user context from DB
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        name: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      res
        .status(401)
        .json({ success: false, error: "User not found or inactive" });
      return;
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Invalid session" });
    return;
  }
}

// ─── Role-based access guard ─────────────────
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;

    if (!roles.includes(user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    next();
  };
}

// ─── Scope all queries to current tenant ─────
export function tenantScope(req: AuthenticatedRequest) {
  return { tenantId: req.user.tenantId };
}
