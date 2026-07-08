import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createAuthenticatedClient, exchangeCode, saveCredentials } from '@/lib/google/oauth';
import { upsertSource } from '@/lib/ingestion/upsert';

export const dynamic = 'force-dynamic';

function redirectWithResult(request: NextRequest, params: Record<string, string>) {
  // TODO: point at the Phase 4 /sources dashboard page once it exists.
  const url = new URL('/', request.nextUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete('gmail_oauth_state');
  return response;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.nextUrl));
  }

  const oauthError = request.nextUrl.searchParams.get('error');
  if (oauthError) {
    return redirectWithResult(request, { gmail_error: oauthError });
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get('gmail_oauth_state')?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithResult(request, { gmail_error: 'invalid_oauth_state' });
  }

  try {
    const tokens = await exchangeCode(code);
    const gmail = google.gmail({ version: 'v1', auth: createAuthenticatedClient(tokens) });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress;
    if (!emailAddress) throw new Error('Gmail profile response did not include an email address');

    const admin = createAdminClient();
    const sourceId = await upsertSource(admin, {
      channelType: 'email',
      provider: 'gmail',
      externalId: emailAddress,
      displayName: emailAddress,
    });
    await saveCredentials(admin, sourceId, tokens);

    return redirectWithResult(request, { gmail_connected: emailAddress });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return redirectWithResult(request, { gmail_error: message });
  }
}
