import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthUrl } from '@/lib/google/oauth';

export const dynamic = 'force-dynamic';

// Kicks off the "connect Gmail" flow. Requires a signed-in dashboard user
// (Phase 4 will add the /login UI this redirects to; until then, sign a
// user in via Supabase Auth directly to exercise this route).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.nextUrl));
  }

  const state = randomBytes(24).toString('hex');
  const response = NextResponse.redirect(getAuthUrl(state));
  response.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/ingest/gmail/oauth',
  });
  return response;
}
