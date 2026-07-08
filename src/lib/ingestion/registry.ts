import type { Connector } from './types';

// Lazily imported so the generic sync route doesn't pull in every provider's
// SDK (googleapis, @slack/web-api, twilio, ...) on every request.
const loaders: Record<string, () => Promise<{ createConnector: () => Connector }>> = {
  gmail: () => import('./gmail'),
};

export async function getConnector(provider: string): Promise<Connector | null> {
  const loader = loaders[provider];
  if (!loader) return null;
  const mod = await loader();
  return mod.createConnector();
}
