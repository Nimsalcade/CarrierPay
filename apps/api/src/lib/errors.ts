import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return new AppError(400, code, message, fieldErrors);
}
export function unauthorized(message = 'Authentication required') {
  return new AppError(401, 'UNAUTHORIZED', message);
}
export function forbidden(message = 'Insufficient permissions') {
  return new AppError(403, 'FORBIDDEN', message);
}
export function notFound(code = 'NOT_FOUND', message = 'Resource not found') {
  return new AppError(404, code, message);
}
export function conflict(code: string, message: string) {
  return new AppError(409, code, message);
}
export function validationError(message: string, fieldErrors?: Record<string, string[]>) {
  return new AppError(422, 'VALIDATION_ERROR', message, fieldErrors);
}

function zodToFieldErrors(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        fieldErrors: err.fieldErrors,
        requestId: (req as Request & { id?: string }).id,
      },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        fieldErrors: zodToFieldErrors(err),
        requestId: (req as Request & { id?: string }).id,
      },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: {
          code: 'DUPLICATE',
          message: 'A record with that unique value already exists.',
          requestId: (req as Request & { id?: string }).id,
        },
      });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({
        error: {
          code: 'INVALID_REFERENCE',
          message: 'A referenced record does not exist.',
          requestId: (req as Request & { id?: string }).id,
        },
      });
      return;
    }
  }
  logger.error({ err }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'An unexpected error occurred.',
      requestId: (req as Request & { id?: string }).id,
    },
  });
}
