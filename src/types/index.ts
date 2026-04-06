// src/types/index.ts
import { Request } from "express";
import { UserRole } from "../generated/prisma/client";

// ─── Authenticated request ──────────────────
export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    tenantId: string;
    email: string;
    role: UserRole;
    name: string;
  };
}

// ─── API response envelope ──────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// ─── Pagination ─────────────────────────────
export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

// ─── Queue job payloads ──────────────────────
export interface FollowUpJobPayload {
  tenantId: string;
  leadId: string;
  taskId: string;
  channel: string;
  content: string;
}

export interface AIScoreJobPayload {
  tenantId: string;
  leadId: string;
}

export interface CommunicationJobPayload {
  tenantId: string;
  leadId: string;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  to: string;
  content: string;
  mediaUrl?: string;
}
