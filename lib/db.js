import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error('MONGO_URI environment variable is not set');
}

let client;
let db;

/**
 * Get MongoDB database connection
 * @returns {Promise<Db>}
 */
export async function getDb() {
  if (db) {
    return db;
  }

  client = new MongoClient(MONGO_URI);
  await client.connect();

  // Extract database name from URI or use default
  const dbName = MONGO_URI.split('/').pop().split('?')[0] || 'next_bruss_dev';
  db = client.db(dbName);

  console.log(`Connected to MongoDB: ${dbName}`);

  return db;
}

/**
 * Get backup jobs collection
 * @returns {Promise<Collection>}
 */
export async function getBackupJobsCollection() {
  const database = await getDb();
  return database.collection('cron_smb_backup_jobs');
}

/**
 * Close MongoDB connection
 */
export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}

// Handle cleanup on process exit
process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDb();
  process.exit(0);
});
