import type { Request, Response, NextFunction } from 'express';
import { getSupabaseAdmin } from '../lib/supabase';

export interface AuthedRequest extends Request {
  userId: string;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: { message: 'Unauthorized' } });
    return;
  }

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: { message: 'Invalid or expired token' } });
    return;
  }

  (req as AuthedRequest).userId = data.user.id;
  next();
}
