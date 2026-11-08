import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config, telegramBotToken } from './config.js';

export interface TelegramIdentity {
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
}

declare module 'fastify' {
  interface FastifyRequest { identity?: TelegramIdentity }
}

export class AuthError extends Error {
  constructor(message: string, readonly statusCode = 401) { super(message); }
}

export function validateInitData(initData: string, botToken: string, nowSeconds = Math.floor(Date.now() / 1000)): TelegramIdentity {
  if (initData.length > 8192) throw new AuthError('initData is too large');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  const userJson = params.get('user');
  if (!receivedHash || !/^[a-f\d]{64}$/i.test(receivedHash) || !Number.isInteger(authDate) || !userJson) {
    throw new AuthError('Malformed Telegram initData');
  }
  const pairs = [...params.entries()].filter(([key]) => key !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, 'hex');
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) throw new AuthError('Invalid Telegram signature');
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > 86400) throw new AuthError('Telegram initData has expired');
  let user: Record<string, unknown>;
  try { user = JSON.parse(userJson) as Record<string, unknown>; } catch { throw new AuthError('Invalid Telegram user data'); }
  const id = user.id;
  if (!(typeof id === 'number' && Number.isSafeInteger(id) && id > 0) && !(typeof id === 'string' && /^\d{1,20}$/.test(id))) throw new AuthError('Invalid Telegram user id');
  const firstName = user.first_name;
  if (typeof firstName !== 'string' || !firstName.trim()) throw new AuthError('Invalid Telegram user name');
  return {
    telegramId: BigInt(id),
    username: typeof user.username === 'string' ? user.username.slice(0, 64) : null,
    firstName: firstName.slice(0, 128),
    lastName: typeof user.last_name === 'string' ? user.last_name.slice(0, 128) : null,
    languageCode: typeof user.language_code === 'string' ? user.language_code.slice(0, 8) : null,
  };
}

export function authenticate(request: FastifyRequest): TelegramIdentity {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.startsWith('tma ')) {
    if (!telegramBotToken) throw new AuthError('Telegram authentication is not configured', 503);
    return validateInitData(header.slice(4), telegramBotToken);
  }
  if (config.DEV_AUTH_ENABLED && config.NODE_ENV !== 'production' && request.headers['x-dev-user-id'] === config.DEV_AUTH_USER_ID) {
    return { telegramId: BigInt(config.DEV_AUTH_USER_ID), username: 'local_demo', firstName: 'Local listener', lastName: null, languageCode: 'uk' };
  }
  throw new AuthError('Provide a valid Telegram Web App initData token');
}
