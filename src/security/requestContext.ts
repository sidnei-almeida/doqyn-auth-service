import type { FastifyRequest } from 'fastify';
import { hashIp, hashUserAgent } from './crypto.js';

export interface RequestContext {
  ip: string;
  ipHash: string;
  userAgent: string;
  userAgentHash: string;
}

export function extractRequestContext(request: FastifyRequest): RequestContext {
  const forwarded = request.headers['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ||
    request.ip ||
    '127.0.0.1';
  const userAgent = (request.headers['user-agent'] as string) || 'unknown';

  return {
    ip,
    ipHash: hashIp(ip),
    userAgent,
    userAgentHash: hashUserAgent(userAgent),
  };
}
