import { Router, Request, Response } from 'express';
import { syncGmail, getSyncStatus } from '../services/gmail';

const router = Router();

router.post('/sync/gmail', async (_req: Request, res: Response) => {
  try {
    const result = await syncGmail();
    res.status(200).json({
      message: 'Sync complete',
      synced: result.synced,
      errors: result.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Sync failed', details: message });
  }
});

router.get('/sync/status', async (_req: Request, res: Response) => {
  try {
    const status = await getSyncStatus();
    res.status(200).json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to retrieve sync status', details: message });
  }
});

export default router;
