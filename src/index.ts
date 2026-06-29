import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import app from './app';
import { pool } from './db/client';
import { runMigrations } from './db/migrate';
import { syncGmail } from './services/gmail';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function start(): Promise<void> {
  await runMigrations();

  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  // Hourly sync at the top of every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[cron] Starting scheduled Gmail sync');
    try {
      const result = await syncGmail();
      console.log(`[cron] Done — synced: ${result.synced}, errors: ${result.errors}`);
    } catch (err) {
      console.error('[cron] Sync failed:', err);
    }
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
