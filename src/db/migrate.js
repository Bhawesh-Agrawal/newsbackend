import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import sql from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const runMigration = async () => {
  try {
    console.log('Running migrations...');

    const files = [
      '005_newsletter.sql'
    ];

    for (const file of files) {
      console.log(`  Running ${file}...`);
      const migrationSQL = readFileSync(
        join(__dirname, 'migrations', file),
        'utf-8'
      );
      await sql.unsafe(migrationSQL);
      console.log(`  Done: ${file}`);
    }

    console.log('All migrations complete');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
};

runMigration();