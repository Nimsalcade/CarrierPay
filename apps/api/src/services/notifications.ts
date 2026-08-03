import { prisma } from '../lib/prisma.js';
import type { NotificationType } from '@carrierpay/shared';

export interface NotifyInput {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

/** Create an in-app notification (PRD §6.9). Email is optional and skipped here. */
export async function notify(input: NotifyInput): Promise<void> {
  await prisma.notification.create({
    data: {
      recipientUserId: input.recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}

export async function notifyAllManagers(type: NotificationType, title: string, body?: string, link?: string) {
  const managers = await prisma.user.findMany({
    where: { role: 'SUPER_ACCOUNT_MANAGER', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const m of managers) {
    await notify({ recipientUserId: m.id, type, title, body, link });
  }
}
