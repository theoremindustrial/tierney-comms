import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConnector } from '@/lib/ingestion/registry';
import type { Connector } from '@/lib/ingestion/types';

// Generic sync trigger for every connector: POST (manual) or GET (Vercel
// Cron, which calls cron routes with GET and an `Authorization: Bearer
// $CRON_SECRET` header when CRON_SECRET is set — see vercel.json). With no
// `sourceId`, syncs every active source for the provider — a cron entry is
// a static path, so it can't name a specific account; per-source `sourceId`
// is for manual/debug triggers against one connection.
export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

async function syncOne(admin: ReturnType<typeof createAdminClient>, connector: Connector, sourceId: string) {
  try {
    const result = await connector.sync(sourceId);
    await admin
      .from('sources')
      .update({ last_synced_at: new Date().toISOString(), last_error: null, status: 'active' })
      .eq('id', sourceId);
    return { sourceId, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    await admin.from('sources').update({ last_error: message, status: 'error' }).eq('id', sourceId);
    return { sourceId, error: message };
  }
}

async function runSync(request: NextRequest, params: Promise<{ provider: string }>) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider } = await params;
  const connector = await getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  const admin = createAdminClient();
  const requestedSourceId = request.nextUrl.searchParams.get('sourceId');

  let sourceIds: string[];
  if (requestedSourceId) {
    sourceIds = [requestedSourceId];
  } else {
    const { data, error } = await admin
      .from('sources')
      .select('id')
      .eq('provider', provider)
      .eq('status', 'active');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    sourceIds = data.map((s) => s.id);
  }

  const results = await Promise.all(sourceIds.map((id) => syncOne(admin, connector, id)));
  return NextResponse.json({ provider, results });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return runSync(request, params);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return runSync(request, params);
}
