import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { AuthError } from '../auth.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error({ err: error }, 'Unhandled API error');
    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
    if (config.NODE_ENV === 'production') {
      return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : error.message });
    }
    return reply.code(status).send({
      error: status >= 500 ? 'Internal server error' : error.message,
      ...(config.NODE_ENV === 'test' ? { detail: error.message } : {}),
    });
  });
}
