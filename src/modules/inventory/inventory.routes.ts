// src/modules/inventory/inventory.routes.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { UnitStatus } from "../../generated/prisma/client";

const router = Router();

// ─── Projects ────────────────────────────────

router.get(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    const projects = await prisma.project.findMany({
      where: { tenantId: user.tenantId },
      include: {
        _count: {
          select: {
            units: true,
            leads: { where: { isDeleted: false } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, data: projects });
  }),
);

router.post(
  "/projects",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = z
      .object({
        name: z.string().min(1),
        location: z.string().min(1),
        description: z.string().optional(),
        amenities: z.array(z.string()).default([]),
      })
      .parse(req.body);

    const project = await prisma.project.create({
      data: { ...body, tenantId: user.tenantId },
    });

    return res.status(201).json({ success: true, data: project });
  }),
);

// ─── Units ────────────────────────────────────

router.get(
  "/projects/:projectId/units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { status, type } = req.query as Record<string, string>;

    const units = await prisma.unit.findMany({
      where: {
        projectId: req.params.projectId,
        tenantId: user.tenantId,
        ...(status && { status: status as UnitStatus }),
        ...(type && { type }),
      },
      include: {
        bookings: {
          where: { status: { not: "CANCELLED" } },
          include: { lead: { select: { name: true, phone: true } } },
        },
      },
      orderBy: [{ floor: "asc" }, { unitNumber: "asc" }],
    });

    const summary = {
      total: units.length,
      available: units.filter((u) => u.status === "AVAILABLE").length,
      hold: units.filter((u) => u.status === "HOLD").length,
      booked: units.filter((u) => u.status === "BOOKED").length,
      sold: units.filter((u) => u.status === "SOLD").length,
    };

    return res.json({ success: true, data: units, meta: summary });
  }),
);

router.post(
  "/projects/:projectId/units",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = z
      .object({
        unitNumber: z.string().min(1),
        tower: z.string().optional(),
        floor: z.number().int().optional(),
        type: z.string().min(1),
        areaSqft: z.number().positive().optional(),
        price: z.number().positive(),
        features: z.array(z.string()).default([]),
      })
      .parse(req.body);

    const unit = await prisma.unit.create({
      data: {
        ...body,
        projectId: req.params.projectId,
        tenantId: user.tenantId,
      },
    });

    return res.status(201).json({ success: true, data: unit });
  }),
);

router.patch(
  "/units/:id/status",
  requireAuth,
  requireRole("BUILDER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { status } = z
      .object({ status: z.nativeEnum(UnitStatus) })
      .parse(req.body);

    const unit = await prisma.unit.updateMany({
      where: { id: req.params.id, tenantId: user.tenantId },
      data: { status },
    });

    return res.json({ success: true, data: unit });
  }),
);

// ─── Bookings ────────────────────────────────

router.post(
  "/bookings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = z
      .object({
        leadId: z.string().uuid(),
        unitId: z.string().uuid(),
        amount: z.number().positive(),
        paymentPlan: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const booking = await prisma.$transaction(async (tx) => {
      // Check unit is still available
      const unit = await tx.unit.findFirst({
        where: {
          id: body.unitId,
          tenantId: user.tenantId,
          status: "AVAILABLE",
        },
      });
      if (!unit) throw new Error("Unit is not available for booking");

      // Create booking
      const newBooking = await tx.booking.create({
        data: { ...body, tenantId: user.tenantId, status: "CONFIRMED" },
      });

      // Mark unit as booked
      await tx.unit.update({
        where: { id: body.unitId },
        data: { status: "BOOKED" },
      });

      // Move lead to BOOKED stage
      await tx.lead.update({
        where: { id: body.leadId },
        data: { stage: "BOOKED" },
      });

      await tx.pipelineStageLog.create({
        data: {
          leadId: body.leadId,
          toStage: "BOOKED",
          movedById: user.id,
          note: `Booked unit ${unit.unitNumber}`,
        },
      });

      return newBooking;
    });

    return res.status(201).json({ success: true, data: booking });
  }),
);

export default router;
