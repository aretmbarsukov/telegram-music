import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, AuthError, type TelegramIdentity } from '../auth.js';

export const idSchema = z.string().min(1).max(64);
export const titleSchema = z.string().trim().min(1).max(120);
export const videoIdSchema = z.string().regex(/^[\w-]{11}$/);

async function authenticateRequest(request: FastifyRequest, reply: FastifyReply, options: { allowQueryInitData?: boolean }): Promise<void> {
  try {
    request.identity = authenticate(request, options);
  } catch (error) {
    const authError = error instanceof AuthError ? error : new AuthError('Authentication failed');
    await reply.code(authError.statusCode).send({ error: authError.message });
  }
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return authenticateRequest(request, reply, {});
}

export async function queryInitDataAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return authenticateRequest(request, reply, { allowQueryInitData: true });
}

export function identity(request: FastifyRequest): TelegramIdentity {
  if (!request.identity) throw new AuthError('Authentication required');
  return request.identity;
}

export function invalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}
