import { Router } from 'express';
import { getSupabaseAdmin } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import type { AuthedRequest } from '../middleware/auth';

const router = Router();

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, fullName, churchName, jobTitle, timezone } = req.body as {
    email: string;
    password: string;
    fullName?: string;
    churchName?: string;
    jobTitle?: string;
    timezone?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: { message: 'Email and password are required' } });
    return;
  }

  const supabase = getSupabaseAdmin();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    res.status(400).json({ error: { message: authError?.message ?? 'Signup failed' } });
    return;
  }

  // Update the user profile (trigger already inserted the base row)
  if (fullName || churchName || jobTitle || timezone) {
    await supabase
      .from('users')
      .update({
        full_name: fullName,
        church_name: churchName,
        job_title: jobTitle ?? null,
        timezone: timezone ?? 'America/Denver',
      })
      .eq('id', authData.user.id);
  }

  // Sign in to get a session for the new user
  const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (sessionError || !sessionData.session) {
    res.status(500).json({ error: { message: 'User created but could not create session' } });
    return;
  }

  res.json({
    user: {
      id: authData.user.id,
      email: authData.user.email,
      fullName,
      churchName,
      jobTitle,
      timezone: timezone ?? 'America/Denver',
    },
    session: sessionData.session,
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };

  if (!email || !password) {
    res.status(400).json({ error: { message: 'Email and password are required' } });
    return;
  }

  const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    res.status(401).json({ error: { message: error?.message ?? 'Login failed' } });
    return;
  }

  res.json({ session: data.session, user: data.user });
});

// POST /auth/logout
router.post('/logout', (_req, res) => {
  // Session management is client-side with Supabase; just confirm
  res.json({ ok: true });
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) {
    res.status(404).json({ error: { message: 'User not found' } });
    return;
  }

  res.json({ user: data });
});

export default router;
