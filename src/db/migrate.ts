import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './client';

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'migrations', '001_initial.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migrations applied');
}

// Runnable directly: npm run migrate
if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
