import express from 'express';
import ldap from 'ldapjs';
import { getDb } from './mongo.js';
import dotenv from 'dotenv';

dotenv.config();

// Store last cron execution times
const cronExecutions = new Map();

// Store component health status
const componentHealth = {
  mongodb: { status: 'unknown', responseTime: 0, lastCheck: null },
  ldap: { status: 'unknown', responseTime: 0, lastCheck: null }
};

/**
 * Update cron execution time
 */
export function updateCronExecution(jobName) {
  cronExecutions.set(jobName, new Date().toISOString());
}

/**
 * Check MongoDB connectivity
 */
async function checkMongoDB() {
  const start = Date.now();
  try {
    const db = await getDb();
    await db.admin().ping();
    const responseTime = Date.now() - start;
    
    componentHealth.mongodb = {
      status: 'healthy',
      responseTime,
      lastCheck: new Date().toISOString()
    };
    
    return { status: 'healthy', responseTime };
  } catch (error) {
    componentHealth.mongodb = {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      lastCheck: new Date().toISOString(),
      error: error.message
    };
    
    return { status: 'unhealthy', error: error.message };
  }
}

/**
 * Check LDAP connectivity
 */
async function checkLDAP() {
  if (!process.env.LDAP || !process.env.LDAP_DN || !process.env.LDAP_PASS) {
    return { status: 'unconfigured' };
  }

  const start = Date.now();
  
  return new Promise((resolve) => {
    const client = ldap.createClient({
      url: process.env.LDAP,
      timeout: 5000,
      connectTimeout: 5000
    });

    const timeoutId = setTimeout(() => {
      client.destroy();
      const responseTime = Date.now() - start;
      componentHealth.ldap = {
        status: 'unhealthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        error: 'Connection timeout'
      };
      resolve({ status: 'unhealthy', error: 'Connection timeout' });
    }, 5000);

    client.bind(process.env.LDAP_DN, process.env.LDAP_PASS, (err) => {
      clearTimeout(timeoutId);
      client.unbind();
      
      const responseTime = Date.now() - start;
      
      if (err) {
        componentHealth.ldap = {
          status: 'unhealthy',
          responseTime,
          lastCheck: new Date().toISOString(),
          error: err.message
        };
        resolve({ status: 'unhealthy', error: err.message });
      } else {
        componentHealth.ldap = {
          status: 'healthy',
          responseTime,
          lastCheck: new Date().toISOString()
        };
        resolve({ status: 'healthy', responseTime });
      }
    });
  });
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

  // Zabbix endpoint - overall status (1=healthy, 0=unhealthy)
  app.get('/zabbix/status', async (_, res) => {
    try {
      const mongoCheck = await checkMongoDB();
      const status = mongoCheck.status === 'healthy' ? 1 : 0;
      res.send(status.toString());
    } catch {
      res.send('0');
    }
  });

  // Zabbix endpoint - MongoDB status
  app.get('/zabbix/mongodb', async (_, res) => {
    try {
      await checkMongoDB();
      const status = componentHealth.mongodb.status === 'healthy' ? 1 : 0;
      res.send(status.toString());
    } catch {
      res.send('0');
    }
  });

  // Zabbix endpoint - LDAP status
  app.get('/zabbix/ldap', async (_, res) => {
    try {
      await checkLDAP();
      const status = componentHealth.ldap.status === 'healthy' ? 1 : 0;
      res.send(status.toString());
    } catch {
      res.send('0');
    }
  });

  // Zabbix endpoint - MongoDB response time (ms)
  app.get('/zabbix/mongodb/response', async (_, res) => {
    try {
      await checkMongoDB();
      res.send(componentHealth.mongodb.responseTime.toString());
    } catch {
      res.send('0');
    }
  });

  // Zabbix endpoint - LDAP response time (ms)
  app.get('/zabbix/ldap/response', async (_, res) => {
    try {
      await checkLDAP();
      res.send(componentHealth.ldap.responseTime.toString());
    } catch {
      res.send('0');
    }
  });

  // Zabbix endpoint - Application uptime (seconds)
  app.get('/zabbix/uptime', (_, res) => {
    res.send(Math.floor(process.uptime()).toString());
  });

  app.listen(port);

  // Run periodic background checks to keep status fresh
  setInterval(async () => {
    try {
      await checkMongoDB();
      await checkLDAP();
    } catch (error) {
      // Silently ignore errors in background checks
    }
  }, 30000); // Every 30 seconds
}

export default { setupHealthCheck, updateCronExecution };