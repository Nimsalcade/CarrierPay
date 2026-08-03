/**
 * Audit logging (PRD §14.3). Every material business mutation records
 * actor, action, entity, before/after JSON, reason, and correlation ID.
 */
import { prisma } from './prisma.js';
import type { AuthedRequest } from '../auth/session.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

const STRINGIFY_BLACKLIST = new Set(['passwordHash', 'csrfTokenHash']);

function safeJson(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  try {
    return JSON.stringify(redact(v));
  } catch {
    return undefined;
  }
}

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (STRINGIFY_BLACKLIST.has(k)) continue;
      out[k] = redact(val);
    }
    return out;
  }
  return v;
}

export async function audit(req: AuthedRequest, input: AuditInput): Promise<void> {
  const requestId = req.id == null ? undefined : String(req.id);
  await prisma.auditLog.create({
    data: {
      actorId: req.user?.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: safeJson(input.before),
      afterJson: safeJson(input.after),
      reason: input.reason,
      requestId,
      ipSummary: req.ip,
    },
  });
}
