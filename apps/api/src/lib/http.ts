import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodSchema } from 'zod';
import { validationError } from './errors.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wrap async handlers so rejections reach the error middleware. */
export function ah(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sort?: string;
  q?: string;
}

export function pagination(req: Request): Pagination {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25) || 25));
  const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, q };
}

/** Validate params, query, and body against Zod schemas in order. */
export function validate(schemas: { params?: ZodSchema; query?: ZodSchema; body?: ZodSchema }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Merge parsed scalars back onto req.query for later reads.
        Object.assign(req.query, parsed);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof Error && 'issues' in err) {
        next(validationError('Request validation failed.', fieldErrors(err)));
      } else {
        next(err);
      }
    }
  };
}

function fieldErrors(err: unknown): Record<string, string[]> | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const issues = (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues;
  if (!issues) return undefined;
  const out: Record<string, string[]> = {};
  for (const i of issues) {
    const key = i.path.join('.') || '_';
    (out[key] ??= []).push(i.message);
  }
  return out;
}
