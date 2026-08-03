import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'carrierpay-api' },
  redact: {
    paths: ['password', 'temporaryPassword', 'currentPassword', 'newPassword', 'token', 'authorization'],
    censor: '[REDACTED]',
  },
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});
