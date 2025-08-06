import express from 'express';
import { getDb } from './mongo.js';
import dotenv from 'dotenv';

dotenv.config();


/**
 * Check MongoDB connectivity
 */
async function checkMongoDB() {
  try {
    const db = await getDb();
    await db.admin().ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if application on port 80 is running
 */
async function checkPort80() {
  try {
    const response = await fetch('http://localhost:80', {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok || response.status < 500;
  } catch (error) {
    return false;
  }
}

/**
 * Setup health check HTTP server for Zabbix
 */
export function setupHealthCheck() {
  if (process.env.HEALTH_CHECK_ENABLED === 'false') {
    return;
  }

  const app = express();
  const port = process.env.HEALTH_CHECK_PORT || 3001;

  // Single Zabbix endpoint - combined status
  // Returns 1 only if ALL services are running
  app.get('/zabbix/status', async (_, res) => {
    try {
      // Check all services
      const [mongoStatus, port80Status] = await Promise.all([
        checkMongoDB(),
        checkPort80()
      ]);
      
      // Return 1 only if everything is working
      const allHealthy = mongoStatus && port80Status;
      res.send(allHealthy ? '1' : '0');
    } catch {
      res.send('0');
    }
  });

  app.listen(port);
}

export default { setupHealthCheck };