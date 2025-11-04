import fs from 'fs/promises';
import { monitorPm2ErrorLogs } from './monitors/pm2-error-logs.js';

async function testPm2Monitor() {
  console.log('Testing PM2 error log monitor...\n');

  // Check if log files exist
  const logFiles = [
    'C:\\ProgramData\\pm2\\home\\logs\\bruss-floor-error.log',
    'C:\\ProgramData\\pm2\\home\\logs\\bruss-intra-error.log',
    'C:\\ProgramData\\pm2\\home\\logs\\bruss-cron-error-6.log',
  ];

  console.log('Checking log files:');
  for (const filePath of logFiles) {
    try {
      const stats = await fs.stat(filePath);
      console.log(`✓ ${filePath}`);
      console.log(`  Size: ${stats.size} bytes`);
      console.log(`  Modified: ${stats.mtime.toLocaleString('pl-PL')}`);

      // Try to read last 5 lines
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter((l) => l.trim());
        const lastLines = lines.slice(-5);
        console.log(`  Last 5 lines:`);
        lastLines.forEach((line, i) => {
          console.log(
            `    ${lines.length - 5 + i + 1}: ${line.substring(0, 100)}${
              line.length > 100 ? '...' : ''
            }`
          );
        });
      } catch (readErr) {
        console.log(`  Error reading file: ${readErr.message}`);
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`✗ ${filePath} - NOT FOUND`);
      } else {
        console.log(`✗ ${filePath} - ERROR: ${err.message}`);
      }
    }
    console.log('');
  }

  console.log('\nRunning monitor function...');
  try {
    const result = await monitorPm2ErrorLogs();
    console.log('\nMonitor result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\nError running monitor:', error);
  }
}

testPm2Monitor().catch(console.error);
