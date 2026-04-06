// src/modules/leads/leads.routes.ts
import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler, paginate } from "../../middleware/errorHandler";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { z } from "zod";
import { LeadSource, LeadStage } from "../../generated/prisma/client";
import { aiScoreQueue } from "../../queues";

const router = Router();

// ─── Validation schemas ───────────────────────
const createLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional(),
  projectId: z.string().uuid().optional(),
  source: z.nativeEnum(LeadSource).default("OTHER"),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  budget: z.number().positive().optional(),
  notes: z.string().optional(),
});

const updateLeadSchema = createLeadSchema.partial().extend({
  assignedToId: z.string().uuid().optional(),
  stage: z.nativeEnum(LeadStage).optional(),
  score: z.number().min(0).max(100).optional(),
});

// ─── GET /leads ───────────────────────────────
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { page, limit, skip } = paginate(req.query as Record<string, string>);
    const { stage, source, assignedToId, projectId, search } =
      req.query as Record<string, string>;

    const where = {
      tenantId: user.tenantId,
      isDeleted: false,
      ...(stage && { stage: stage as LeadStage }),
      ...(source && { source: source as LeadSource }),
      ...(assignedToId && { assignedToId }),
      ...(projectId && { projectId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      // Agents only see their assigned leads
      ...(user.role === "AGENT" && { assignedToId: user.id }),
    };

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          assignedTo: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          aiScores: { orderBy: { scoredAt: "desc" }, take: 1 },
          _count: { select: { comms: true, siteVisits: true } },
        },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ]);

    return res.json({
      success: true,
      data: leads,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }),
);

// ─── POST /leads ──────────────────────────────
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = createLeadSchema.parse(req.body);

    const lead = await prisma.$transaction(async (tx) => {
      const newLead = await tx.lead.create({
        data: { ...body, tenantId: user.tenantId },
      });

      // Record initial stage log
      await tx.pipelineStageLog.create({
        data: {
          leadId: newLead.id,
          toStage: "NEW",
          movedById: user.id,
        },
      });

      return newLead;
    });

    // Queue AI scoring job
    await aiScoreQueue.add("score-lead", {
      tenantId: user.tenantId,
      leadId: lead.id,
    });

    return res.status(201).json({ success: true, data: lead });
  }),
);

// ─── GET /leads/:id ───────────────────────────
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId, isDeleted: false },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        project: true,
        comms: { orderBy: { sentAt: "desc" }, take: 50 },
        siteVisits: { orderBy: { scheduledAt: "desc" } },
        bookings: { include: { unit: true } },
        aiScores: { orderBy: { scoredAt: "desc" }, take: 5 },
        followUps: { where: { completed: false }, orderBy: { dueAt: "asc" } },
        stageLogs: {
          include: { movedBy: { select: { name: true } } },
          orderBy: { movedAt: "desc" },
        },
      },
    });

    if (!lead)
      return res.status(404).json({ success: false, error: "Lead not found" });
    return res.json({ success: true, data: lead });
  }),
);

// ─── PATCH /leads/:id ─────────────────────────
router.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = updateLeadSchema.parse(req.body);

    const existing = await prisma.lead.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId },
    });
    if (!existing)
      return res.status(404).json({ success: false, error: "Lead not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: req.params.id },
        data: body,
      });

      // Log stage change
      if (body.stage && body.stage !== existing.stage) {
        await tx.pipelineStageLog.create({
          data: {
            leadId: lead.id,
            fromStage: existing.stage,
            toStage: body.stage,
            movedById: user.id,
          },
        });
      }

      return lead;
    });

    return res.json({ success: true, data: updated });
  }),
);

// ─── DELETE /leads/:id (soft delete) ─────────
router.delete(
  "/:id",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    await prisma.lead.updateMany({
      where: { id: req.params.id, tenantId: user.tenantId },
      data: { isDeleted: true },
    });

    return res.json({ success: true });
  }),
);

export default router;
