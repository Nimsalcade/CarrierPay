/**
 * Load management (PRD §6.4).
 *
 * Document attachments (proof-of-delivery / rate confirmation, §6.4) are
 * uploaded as multipart under /loads/:id/attachments. Files are written to
 * storage/documents/loads/<loadId>/<uuid><ext>; the database holds only
 * metadata (original name, MIME, size) per §14.2.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { LoadStatus, UserRole, loadCreateSchema, loadStatusSchema, loadUpdateSchema } from '@carrierpay/shared';
import { ah, pagination, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { storageDir } from '../lib/config.js';
import { assertTransition, markStaleForLoad } from '../services/loads.js';

/** Load attachment upload policy (PRD §14.2): whitelisted MIME types + size cap. */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ATTACHMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']);
const ATTACHMENT_KINDS = new Set(['POD', 'RATE_CONFIRMATION']);

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type "${file.mimetype}". Allowed: PDF, JPEG, PNG, TIFF.`));
    }
    cb(null, true);
  },
});

/** Wrap multer so its errors surface as clean API responses, not 500s. */
function multerSafe(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    mw(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(badRequest('FILE_TOO_LARGE', `File exceeds the ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB limit.`));
        }
        return next(badRequest('UPLOAD_ERROR', `Upload failed: ${err.message}`));
      }
      next(err as Error);
    });
  };
}

const attachmentUploadMiddleware = multerSafe(attachmentUpload.single('file'));

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]/g, '').slice(0, 120);
  return cleaned || 'attachment';
}

export const loadRoutes = Router();
loadRoutes.use(requireAuth, requireCsrf);

const loadInclude = {
  bookedBy: { select: { id: true, firstName: true, lastName: true } },
  driver: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  truck: true,
  trailer: true,
  statusHistory: { orderBy: { createdAt: 'desc' as const }, take: 5 },
};

function loadWhereForRole(role: UserRole, userId: string): Record<string, unknown> {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER) return {};
  if (role === UserRole.DISPATCHER) return { OR: [{ bookedByUserId: userId }, { driverUserId: userId }] };
  if (role === UserRole.DRIVER) return { driverUserId: userId };
  return {};
}

loadRoutes.get(
  '/loads',
  ah(async (req: AuthedRequest, res) => {
    const pg = pagination(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: Record<string, unknown> = { ...loadWhereForRole(req.user!.role as UserRole, req.user!.id) };
    if (status) where.status = status;
    if (pg.q) where.OR = [...(Array.isArray(where.OR) ? (where.OR as unknown[]) : []), { loadNumber: { contains: pg.q } }, { customerName: { contains: pg.q } }];

    const [items, total] = await Promise.all([
      prisma.load.findMany({ where, include: loadInclude, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
      prisma.load.count({ where }),
    ]);
    res.json({ items, total, page: pg.page, pageSize: pg.pageSize });
  }),
);

loadRoutes.post(
  '/loads',
  validate({ body: loadCreateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const role = req.user!.role as UserRole;
    const body = req.body as {
      loadNumber: string;
      bookedByUserId?: string;
      driverUserId?: string;
      truckId?: string | null;
      trailerId?: string | null;
      customerName: string;
      confirmationNumber?: string;
      originFacility: string;
      originCity?: string;
      originState?: string;
      originZip?: string;
      pickupAt?: string;
      destinationFacility: string;
      destinationCity?: string;
      destinationState?: string;
      destinationZip?: string;
      deliveryAt?: string;
      grossRateCents: number;
      accessorialGrossCents?: number;
      loadedMilesHundredths: number;
      emptyMilesHundredths?: number;
      status?: LoadStatus;
      internalNotes?: string;
      driverInstructions?: string;
    };

    if (role !== UserRole.DISPATCHER && role !== UserRole.SUPER_ACCOUNT_MANAGER) throw forbidden();
    const bookedByUserId = body.bookedByUserId ?? req.user!.id;
    if (role === UserRole.DISPATCHER && bookedByUserId !== req.user!.id) {
      throw forbidden('Dispatchers can only book loads for themselves.');
    }
    if (!body.driverUserId) throw badRequest('DRIVER_REQUIRED', 'A driver must be assigned.');

    const loadNumber = body.loadNumber.trim().toUpperCase();
    const dup = await prisma.load.findUnique({ where: { loadNumber } });
    if (dup) throw badRequest('DUPLICATE_LOAD_NUMBER', `Load ${loadNumber} already exists.`);

    const load = await prisma.$transaction(async (tx) => {
      const created = await tx.load.create({
        data: {
          loadNumber,
          bookedByUserId,
          driverUserId: body.driverUserId,
          truckId: body.truckId || null,
          trailerId: body.trailerId || null,
          customerName: body.customerName.trim(),
          confirmationNumber: body.confirmationNumber || null,
          originFacility: body.originFacility.trim(),
          originCity: body.originCity || null,
          originState: body.originState || null,
          originZip: body.originZip || null,
          pickupAt: body.pickupAt ? new Date(body.pickupAt) : null,
          destinationFacility: body.destinationFacility.trim(),
          destinationCity: body.destinationCity || null,
          destinationState: body.destinationState || null,
          destinationZip: body.destinationZip || null,
          deliveryAt: body.deliveryAt ? new Date(body.deliveryAt) : null,
          grossRateCents: body.grossRateCents,
          accessorialGrossCents: body.accessorialGrossCents ?? null,
          loadedMilesHundredths: body.loadedMilesHundredths,
          emptyMilesHundredths: body.emptyMilesHundredths ?? 0,
          status: body.status ?? LoadStatus.DRAFT,
          internalNotes: body.internalNotes || null,
          driverInstructions: body.driverInstructions || null,
        },
      });
      await tx.loadStatusHistory.create({
        data: { loadId: created.id, toStatus: created.status, actorId: req.user!.id, note: 'Created' },
      });
      return created;
    });

    await audit(req, { action: 'LOAD.CREATE', entityType: 'load', entityId: load.id, after: { loadNumber, grossRateCents: load.grossRateCents } });
    res.status(201).json(load);
  }),
);

loadRoutes.get(
  '/loads/:id',
  ah(async (req: AuthedRequest, res) => {
    const load = await prisma.load.findUnique({ where: { id: req.params.id }, include: loadInclude });
    if (!load) throw notFound('LOAD_NOT_FOUND');
    authorizeLoadView(load, req.user!.role as UserRole, req.user!.id);
    res.json(load);
  }),
);

loadRoutes.patch(
  '/loads/:id',
  validate({ body: loadUpdateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const existing = await prisma.load.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('LOAD_NOT_FOUND');
    authorizeLoadEdit(existing, req.user!.role as UserRole, req.user!.id);
    if (existing.status === LoadStatus.PAYROLL_LOCKED) {
      throw badRequest('LOAD_LOCKED', 'This load is locked by a published payroll period. Use a correction adjustment.');
    }

    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of ['customerName', 'confirmationNumber', 'originFacility', 'originCity', 'originState', 'originZip', 'destinationFacility', 'destinationCity', 'destinationState', 'destinationZip', 'grossRateCents', 'accessorialGrossCents', 'loadedMilesHundredths', 'emptyMilesHundredths', 'internalNotes', 'driverInstructions', 'driverUserId', 'truckId', 'trailerId']) {
      if (key in body) data[key] = body[key];
    }
    if ('loadNumber' in body && typeof body.loadNumber === 'string') {
      const ln = body.loadNumber.trim().toUpperCase();
      const dup = await prisma.load.findUnique({ where: { loadNumber: ln } });
      if (dup && dup.id !== existing.id) throw badRequest('DUPLICATE_LOAD_NUMBER', `Load ${ln} already exists.`);
      data.loadNumber = ln;
    }
    if ('pickupAt' in body) data.pickupAt = body.pickupAt ? new Date(body.pickupAt as string) : null;
    if ('deliveryAt' in body) data.deliveryAt = body.deliveryAt ? new Date(body.deliveryAt as string) : null;

    const updated = await prisma.load.update({ where: { id: existing.id }, data });
    await markStaleForLoad(existing.id);
    await audit(req, {
      action: 'LOAD.UPDATE',
      entityType: 'load',
      entityId: existing.id,
      before: { grossRateCents: existing.grossRateCents, status: existing.status },
      after: { grossRateCents: updated.grossRateCents, status: updated.status },
    });
    res.json(updated);
  }),
);

loadRoutes.post(
  '/loads/:id/status',
  validate({ body: loadStatusSchema }),
  ah(async (req: AuthedRequest, res) => {
    const existing = await prisma.load.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('LOAD_NOT_FOUND');
    const toStatus = (req.body as { status: LoadStatus }).status as LoadStatus;
    const reason = (req.body as { reason?: string }).reason;

    assertTransition(existing.status as LoadStatus, toStatus, reason);

    const role = req.user!.role as UserRole;
    if (role === UserRole.DRIVER) throw forbidden();
    if (role === UserRole.ASSISTANT_ACCOUNT_MANAGER) throw forbidden();
    if (role === UserRole.DISPATCHER && existing.bookedByUserId !== req.user!.id && existing.driverUserId !== req.user!.id) {
      throw forbidden();
    }
    // Correction transitions need super permission.
    const needsSuper = (existing.status === LoadStatus.DELIVERED || existing.status === LoadStatus.PAYROLL_LOCKED);
    if (needsSuper && role !== UserRole.SUPER_ACCOUNT_MANAGER) throw forbidden();

    if (toStatus === LoadStatus.DELIVERED && !existing.deliveryAt) {
      throw badRequest('MISSING_DELIVERY', 'A delivery timestamp is required to mark a load delivered.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const load = await tx.load.update({ where: { id: existing.id }, data: { status: toStatus } });
      await tx.loadStatusHistory.create({
        data: { loadId: existing.id, fromStatus: existing.status, toStatus, actorId: req.user!.id, note: reason || null },
      });
      return load;
    });

    if (toStatus !== LoadStatus.PAYROLL_LOCKED) {
      // Editing eligibility status may stale existing payroll entries.
      await markStaleForLoad(existing.id);
    }
    await audit(req, {
      action: 'LOAD.STATUS',
      entityType: 'load',
      entityId: existing.id,
      before: { status: existing.status },
      after: { status: toStatus },
      reason,
    });
    res.json(updated);
  }),
);

// ---------------------------------------------------------------------------
// Load document attachments (POD / rate confirmation) — PRD §6.4
// ---------------------------------------------------------------------------

/** Strip internal fields before returning an attachment to the client. */
function publicAttachment(a: {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedBy?: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
}) {
  return {
    id: a.id,
    kind: a.kind,
    originalName: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
    uploadedBy: a.uploadedBy
      ? { id: a.uploadedBy.id, firstName: a.uploadedBy.firstName, lastName: a.uploadedBy.lastName, employeeCode: a.uploadedBy.employeeCode }
      : null,
  };
}

loadRoutes.post(
  '/loads/:id/attachments',
  attachmentUploadMiddleware,
  ah(async (req: AuthedRequest, res) => {
    const load = await prisma.load.findUnique({ where: { id: req.params.id } });
    if (!load) throw notFound('LOAD_NOT_FOUND');
    authorizeLoadView(load, req.user!.role as UserRole, req.user!.id);

    const file = req.file;
    if (!file) throw badRequest('FILE_REQUIRED', 'Attach a file to upload.');
    const kind = String((req.body as { kind?: string }).kind ?? 'POD').toUpperCase();
    if (!ATTACHMENT_KINDS.has(kind)) throw badRequest('INVALID_KIND', 'kind must be POD or RATE_CONFIRMATION.');

    const originalName = path.basename(file.originalname || 'attachment');
    const generatedId = crypto.randomUUID();
    const ext = path.extname(originalName).slice(0, 12).toLowerCase();
    const dir = path.join(storageDir('documents'), 'loads', load.id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${generatedId}${ext}`);
    fs.writeFileSync(filePath, file.buffer);

    const record = await prisma.loadAttachment.create({
      data: {
        loadId: load.id,
        kind,
        filePath,
        originalName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: req.user!.id,
      },
    });
    await audit(req, {
      action: 'LOAD.ATTACHMENT_UPLOAD',
      entityType: 'load',
      entityId: load.id,
      after: { attachmentId: record.id, kind, originalName, sizeBytes: file.size },
    });
    res.status(201).json(publicAttachment(record));
  }),
);

loadRoutes.get(
  '/loads/:id/attachments',
  ah(async (req: AuthedRequest, res) => {
    const load = await prisma.load.findUnique({ where: { id: req.params.id } });
    if (!load) throw notFound('LOAD_NOT_FOUND');
    authorizeLoadView(load, req.user!.role as UserRole, req.user!.id);

    const items = await prisma.loadAttachment.findMany({
      where: { loadId: load.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
    });
    res.json(items.map(publicAttachment));
  }),
);

loadRoutes.get(
  '/loads/:id/attachments/:attachmentId/download',
  ah(async (req: AuthedRequest, res) => {
    const load = await prisma.load.findUnique({ where: { id: req.params.id } });
    if (!load) throw notFound('LOAD_NOT_FOUND');
    authorizeLoadView(load, req.user!.role as UserRole, req.user!.id);

    const att = await prisma.loadAttachment.findFirst({ where: { id: req.params.attachmentId, loadId: load.id } });
    if (!att) throw notFound('ATTACHMENT_NOT_FOUND');
    if (!fs.existsSync(att.filePath)) throw notFound('ATTACHMENT_FILE_MISSING', 'The file is missing on disk.');

    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(att.originalName)}"`);
    fs.createReadStream(att.filePath).pipe(res);
  }),
);

loadRoutes.delete(
  '/loads/:id/attachments/:attachmentId',
  ah(async (req: AuthedRequest, res) => {
    const load = await prisma.load.findUnique({ where: { id: req.params.id } });
    if (!load) throw notFound('LOAD_NOT_FOUND');

    const att = await prisma.loadAttachment.findFirst({ where: { id: req.params.attachmentId, loadId: load.id } });
    if (!att) throw notFound('ATTACHMENT_NOT_FOUND');
    const role = req.user!.role as UserRole;
    const isManager = role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER;
    if (!isManager && att.uploadedById !== req.user!.id) throw forbidden();

    await prisma.loadAttachment.delete({ where: { id: att.id } });
    fs.rmSync(att.filePath, { force: true });
    await audit(req, {
      action: 'LOAD.ATTACHMENT_DELETE',
      entityType: 'load',
      entityId: load.id,
      after: { attachmentId: att.id, originalName: att.originalName },
    });
    res.json({ ok: true });
  }),
);

function authorizeLoadView(load: { driverUserId: string | null; bookedByUserId: string }, role: UserRole, userId: string): void {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER) return;
  if (role === UserRole.DRIVER && load.driverUserId === userId) return;
  if (role === UserRole.DISPATCHER && (load.bookedByUserId === userId || load.driverUserId === userId)) return;
  throw forbidden();
}

function authorizeLoadEdit(load: { driverUserId: string | null; bookedByUserId: string; status: string }, role: UserRole, userId: string): void {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER) return;
  if (role === UserRole.DISPATCHER && (load.bookedByUserId === userId) && !['DELIVERED', 'PAYROLL_LOCKED'].includes(load.status)) return;
  throw forbidden();
}
