/**
 * Equipment management and assignment (PRD §6.3).
 * One active assignment per equipment unit; assignment history is append-only.
 */
import { Router } from 'express';
import {
  EquipmentStatus,
  EquipmentType,
  UserRole,
  equipmentAssignSchema,
  equipmentCreateSchema,
  equipmentReturnSchema,
  equipmentUpdateSchema,
} from '@carrierpay/shared';
import { ah, pagination, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

export const equipmentRoutes = Router();
equipmentRoutes.use(requireAuth, requireCsrf);

function canManageEquipment(role: UserRole): boolean {
  return role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER;
}

equipmentRoutes.get(
  '/equipment',
  ah(async (req: AuthedRequest, res) => {
    const pg = pagination(req);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (pg.q) where.OR = [{ unitNumber: { contains: pg.q } }, { make: { contains: pg.q } }];

    // Dispatchers and drivers only see assigned/available summaries; drivers only see their own.
    const role = req.user!.role as UserRole;
    if (role === UserRole.DRIVER) {
      where.assignments = { some: { driverUserId: req.user!.id, returnedAt: null } };
    }

    const [items, total] = await Promise.all([
      prisma.equipment.findMany({
        where,
        include: {
          assignments: {
            where: { returnedAt: null },
            include: { driver: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
          },
        },
        orderBy: { unitNumber: 'asc' },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.equipment.count({ where }),
    ]);
    res.json({ items, total, page: pg.page, pageSize: pg.pageSize });
  }),
);

equipmentRoutes.post(
  '/equipment',
  validate({ body: equipmentCreateSchema }),
  ah(async (req: AuthedRequest, res) => {
    if (!canManageEquipment(req.user!.role as UserRole)) throw forbidden();
    const body = req.body as {
      type: EquipmentType;
      unitNumber: string;
      vin?: string;
      year?: number | null;
      make?: string;
      model?: string;
      plate?: string;
      plateState?: string;
      odometerMiles?: number | null;
      notes?: string;
    };
    const unitNumber = body.unitNumber.toUpperCase();
    const existing = await prisma.equipment.findFirst({ where: { unitNumber } });
    if (existing) throw conflict('DUPLICATE_UNIT', `Equipment unit "${unitNumber}" already exists.`);

    const equipment = await prisma.equipment.create({
      data: {
        type: body.type,
        unitNumber,
        vin: body.vin || null,
        year: body.year ?? null,
        make: body.make || null,
        model: body.model || null,
        plate: body.plate || null,
        plateState: body.plateState || null,
        odometerMiles: body.odometerMiles ?? null,
        notes: body.notes || null,
        status: EquipmentStatus.AVAILABLE,
      },
    });
    await audit(req, { action: 'EQUIPMENT.CREATE', entityType: 'equipment', entityId: equipment.id });
    res.status(201).json(equipment);
  }),
);

equipmentRoutes.patch(
  '/equipment/:id',
  validate({ body: equipmentUpdateSchema }),
  ah(async (req: AuthedRequest, res) => {
    if (!canManageEquipment(req.user!.role as UserRole)) throw forbidden();
    const existing = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('EQUIPMENT_NOT_FOUND');
    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of ['type', 'vin', 'year', 'make', 'model', 'plate', 'plateState', 'odometerMiles', 'notes', 'status']) {
      if (key in body) data[key] = body[key];
    }
    const updated = await prisma.equipment.update({ where: { id: existing.id }, data });
    await audit(req, {
      action: 'EQUIPMENT.UPDATE',
      entityType: 'equipment',
      entityId: existing.id,
      before: { status: existing.status },
      after: { status: updated.status },
    });
    res.json(updated);
  }),
);

equipmentRoutes.get(
  '/equipment/:id',
  ah(async (req: AuthedRequest, res) => {
    const equipment = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      include: { assignments: { include: { driver: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } }, orderBy: { assignedAt: 'desc' } } },
    });
    if (!equipment) throw notFound('EQUIPMENT_NOT_FOUND');
    const role = req.user!.role as UserRole;
    if (role === UserRole.DRIVER) {
      const own = equipment.assignments.some((a) => a.driverUserId === req.user!.id && !a.returnedAt);
      if (!own) throw forbidden();
    }
    res.json(equipment);
  }),
);

equipmentRoutes.post(
  '/equipment/:id/assign',
  validate({ body: equipmentAssignSchema }),
  ah(async (req: AuthedRequest, res) => {
    if (!canManageEquipment(req.user!.role as UserRole)) throw forbidden();
    const { driverUserId, assignedAt, notes, overrideReason } = req.body as {
      driverUserId: string;
      assignedAt?: string;
      notes?: string;
      overrideReason?: string;
    };

    const equipment = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!equipment) throw notFound('EQUIPMENT_NOT_FOUND');
    const driver = await prisma.user.findUnique({ where: { id: driverUserId } });
    if (!driver || driver.role !== UserRole.DRIVER) throw badRequest('NOT_A_DRIVER', 'Assignment target must be an active driver.');
    if (driver.status !== 'ACTIVE') throw badRequest('DRIVER_INACTIVE', 'Cannot assign equipment to a non-active driver.');
    if (equipment.status === EquipmentStatus.RETIRED || equipment.status === EquipmentStatus.OUT_OF_SERVICE) {
      throw conflict('EQUIPMENT_UNAVAILABLE', `Equipment is ${equipment.status}.`);
    }

    const at = assignedAt ? new Date(assignedAt) : new Date();

    await prisma.$transaction(async (tx) => {
      // Close any current assignment of this equipment unit.
      await tx.equipmentAssignment.updateMany({
        where: { equipmentId: equipment.id, returnedAt: null },
        data: { returnedAt: at },
      });

      // Default limits: one active truck and one active trailer per driver.
      const activeAssignments = await tx.equipmentAssignment.findMany({
        where: { driverUserId, returnedAt: null },
        include: { equipment: true },
      });
      if (!overrideReason) {
        const activeTruck = activeAssignments.find((a) => a.equipment.type === EquipmentType.TRUCK);
        const activeTrailer = activeAssignments.find((a) => a.equipment.type === EquipmentType.TRAILER);
        if (equipment.type === EquipmentType.TRUCK && activeTruck) {
          throw conflict('EQUIPMENT_CONFLICT', `Driver already has active truck ${activeTruck.equipment.unitNumber}. Override requires a reason.`);
        }
        if (equipment.type === EquipmentType.TRAILER && activeTrailer) {
          throw conflict('EQUIPMENT_CONFLICT', `Driver already has active trailer ${activeTrailer.equipment.unitNumber}. Override requires a reason.`);
        }
      }

      await tx.equipmentAssignment.create({
        data: {
          equipmentId: equipment.id,
          driverUserId,
          assignedAt: at,
          assignedBy: req.user!.id,
          notes: notes || null,
          overrideReason: overrideReason || null,
        },
      });
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: EquipmentStatus.ASSIGNED } });
    });

    await audit(req, {
      action: 'EQUIPMENT.ASSIGN',
      entityType: 'equipment',
      entityId: equipment.id,
      after: { driverUserId, assignedAt: at.toISOString() },
      reason: overrideReason || undefined,
    });
    res.json({ ok: true });
  }),
);

equipmentRoutes.post(
  '/equipment/:id/return',
  validate({ body: equipmentReturnSchema }),
  ah(async (req: AuthedRequest, res) => {
    if (!canManageEquipment(req.user!.role as UserRole)) throw forbidden();
    const { returnedAt, notes } = req.body as { returnedAt?: string; notes?: string };
    const at = returnedAt ? new Date(returnedAt) : new Date();

    const updated = await prisma.equipmentAssignment.updateMany({
      where: { equipmentId: req.params.id, returnedAt: null },
      data: { returnedAt: at, notes: notes ?? undefined },
    });
    if (updated.count === 0) throw badRequest('NO_ACTIVE_ASSIGNMENT', 'This equipment unit has no active assignment.');
    await prisma.equipment.update({ where: { id: req.params.id }, data: { status: EquipmentStatus.AVAILABLE } });
    await audit(req, { action: 'EQUIPMENT.RETURN', entityType: 'equipment', entityId: req.params.id });
    res.json({ ok: true });
  }),
);
