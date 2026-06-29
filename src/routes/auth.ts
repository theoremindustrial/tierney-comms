import { Router, Request, Response } from 'express';
import { getAuthUrl, exchangeCodeForTokens } from '../services/gmail';

const router = Router();

router.get('/auth/gmail', (_req: Request, res: Response) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// GET handler: used by the standard browser OAuth redirect from Google
router.get('/auth/gmail/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    res.status(400).json({ error: 'OAuth authorization denied', details: error });
    return;
  }
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    await exchangeCodeForTokens(code);
    res.status(200).json({ message: 'Gmail authentication successful' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to exchange authorization code', details: message });
  }
});

// POST handler: used when a mobile/SPA client sends the code in the request body
router.post('/auth/gmail/callback', async (req: Request, res: Response) => {
  const { code } = req.body as { code?: string };

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    await exchangeCodeForTokens(code);
    res.status(200).json({ message: 'Gmail authentication successful' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to exchange authorization code', details: message });
  }
});

export default router;
