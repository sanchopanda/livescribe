import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex'); // 64 hex chars
  return { raw, hash: hashToken(raw) };
}
export function signJwt(userId: string): string {
  return jwt.sign({ userId }, SECRET, { expiresIn: '30d' });
}
export function verifyJwt(token: string): { userId: string } | null {
  try {
    const p = jwt.verify(token, SECRET) as { userId: string };
    return { userId: p.userId };
  } catch {
    return null;
  }
}
