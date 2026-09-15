import type { FastifyRequest } from 'fastify';
import { hashIp, hashUserAgent } from './crypto.js';

export interface RequestContext {
  ip: string;
  ipHash: string;
  userAgent: string;
  userAgentHash: string;
}

/**
 * Quantos proxies à frente do serviço são nossos: só o nginx.
 *
 * Com `trustProxy: true` o Fastify confiava na cadeia inteira do `X-Forwarded-For`, e o valor mais à
 * esquerda é o que o cliente mandou — o nginx acrescenta o endereço real no fim. Um header inventado
 * por requisição trocava o `ipHash` e zerava todo limite por IP (login, cadastro, reset, verificação).
 * Com um salto só, `request.ip` é a última entrada, a que o nginx escreveu.
 */
export const TRUSTED_PROXY_HOPS = 1;

export function extractRequestContext(request: FastifyRequest): RequestContext {
  const ip = request.ip || '127.0.0.1';
  const userAgent = (request.headers['user-agent'] as string) || 'unknown';

  return {
    ip,
    ipHash: hashIp(ip),
    userAgent,
    userAgentHash: hashUserAgent(userAgent),
  };
}
