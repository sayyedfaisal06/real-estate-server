// src/modules/analytics/analytics.routes.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { LeadStage } from "../../generated/prisma/client";

const router = Router();

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  projectId: z.string().uuid().optional(),
});

// ─── GET /analytics/funnel ────────────────────
router.get(
  "/funnel",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { from, to, projectId } = dateRangeSchema.parse(req.query);

    const where = {
      tenantId: user.tenantId,
      isDeleted: false,
      ...(projectId && { projectId }),
      ...(from &&
        to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
    };

    const stages: LeadStage[] = [
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "VISIT_SCHEDULED",
      "VISIT_DONE",
      "NEGOTIATION",
      "BOOKED",
      "LOST",
    ];

    const counts = await Promise.all(
      stages.map((stage) =>
        prisma.lead
          .count({ where: { ...where, stage } })
          .then((count) => ({ stage, count })),
      ),
    );

    const total = counts.reduce((sum, s) => sum + s.count, 0);

    const funnel = counts.map((s, i) => ({
      stage: s.stage,
      count: s.count,
      percentage:
        total > 0 ? parseFloat(((s.count / total) * 100).toFixed(1)) : 0,
      conversionFromPrev:
        i > 0 && counts[i - 1].count > 0
          ? parseFloat(((s.count / counts[i - 1].count) * 100).toFixed(1))
          : null,
    }));

    return res.json({ success: true, data: { funnel, total } });
  }),
);

// ─── GET /analytics/team ─────────────────────
router.get(
  "/team",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { from, to } = dateRangeSchema.parse(req.query);

    const dateFilter =
      from && to
        ? { createdAt: { gte: new Date(from), lte: new Date(to) } }
        : {};

    const agents = await prisma.user.findMany({
      where: { tenantId: user.tenantId, role: "AGENT", isActive: true },
      select: { id: true, name: true },
    });

    const stats = await Promise.all(
      agents.map(async (agent) => {
        const [totalLeads, bookedLeads, commsCount, visitsCount] =
          await Promise.all([
            prisma.lead.count({
              where: {
                assignedToId: agent.id,
                tenantId: user.tenantId,
                isDeleted: false,
                ...dateFilter,
              },
            }),
            prisma.lead.count({
              where: {
                assignedToId: agent.id,
                tenantId: user.tenantId,
                stage: "BOOKED",
                ...dateFilter,
              },
            }),
            prisma.communication.count({
              where: {
                tenantId: user.tenantId,
                lead: { assignedToId: agent.id },
                direction: "OUTBOUND",
                ...dateFilter,
              },
            }),
            prisma.siteVisit.count({
              where: { agentId: agent.id, status: "COMPLETED", ...dateFilter },
            }),
          ]);

        return {
          agent,
          totalLeads,
          bookedLeads,
          conversionRate:
            totalLeads > 0
              ? parseFloat(((bookedLeads / totalLeads) * 100).toFixed(1))
              : 0,
          commsCount,
          visitsCount,
        };
      }),
    );

    return res.json({ success: true, data: stats });
  }),
);

// ─── GET /analytics/sources ──────────────────
router.get(
  "/sources",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { from, to, projectId } = dateRangeSchema.parse(req.query);

    const grouped = await prisma.lead.groupBy({
      by: ["source"],
      where: {
        tenantId: user.tenantId,
        isDeleted: false,
        ...(projectId && { projectId }),
        ...(from &&
          to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
      },
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
    });

    const bookedBySource = await Promise.all(
      grouped.map((g) =>
        prisma.lead
          .count({
            where: {
              tenantId: user.tenantId,
              source: g.source,
              stage: "BOOKED",
            },
          })
          .then((booked) => ({
            source: g.source,
            total: g._count._all,
            booked,
          })),
      ),
    );

    return res.json({ success: true, data: bookedBySource });
  }),
);

// ─── GET /analytics/overview ──────────────────
router.get(
  "/overview",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    const [
      totalLeads,
      hotLeads,
      visitsToday,
      bookingsThisMonth,
      availableUnits,
    ] = await Promise.all([
      prisma.lead.count({
        where: { tenantId: user.tenantId, isDeleted: false },
      }),
      prisma.lead.count({
        where: {
          tenantId: user.tenantId,
          score: { gte: 70 },
          isDeleted: false,
        },
      }),
      prisma.siteVisit.count({
        where: {
          lead: { tenantId: user.tenantId },
          scheduledAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lte: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
      }),
      prisma.booking.count({
        where: {
          tenantId: user.tenantId,
          status: "CONFIRMED",
          bookedAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      prisma.unit.count({
        where: { tenantId: user.tenantId, status: "AVAILABLE" },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        totalLeads,
        hotLeads,
        visitsToday,
        bookingsThisMonth,
        availableUnits,
      },
    });
  }),
);

export default router;
