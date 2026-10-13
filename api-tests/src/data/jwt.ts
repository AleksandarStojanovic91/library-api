/** Minimal HS256 JWT helpers for the auth tests (forging expired, tampered and unsigned tokens). */
import { createHmac } from 'node:crypto';

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

export interface JwtClaims {
  sub?: string;
  role?: string;
  email?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  [claim: string]: unknown;
}

export function decodeJwt(token: string): { header: Record<string, unknown>; claims: JwtClaims } {
  const [header, payload] = token.split('.');
  if (!header || !payload) throw new Error('not a JWT');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    claims: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  };
}

export function signHs256(claims: JwtClaims, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** `alg: none` token: must never be accepted. */
export function unsigned(claims: JwtClaims): string {
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.`;
}

/** Keeps header and signature, swaps the payload: the signature no longer matches. */
export function withTamperedClaims(token: string, change: Partial<JwtClaims>): string {
  const [header, , signature] = token.split('.');
  const { claims } = decodeJwt(token);
  return `${header}.${b64url(JSON.stringify({ ...claims, ...change }))}.${signature}`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
