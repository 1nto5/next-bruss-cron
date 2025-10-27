import dotenv from 'dotenv';
import SMB2 from 'v9u-smb2';
import { statusCollector } from './lib/status-collector.js';

dotenv.config();

/**
 * Connect to source SMB share (standard SMB)
 * @param {string} ip - IP address
 * @param {string} share - Share name
 * @param {string} username - SMB username
 * @param {string} password - SMB password
 * @returns {Promise<SMB2>}
 */
async function connectToSourceSmb(ip, share, username, password) {
  const client = new SMB2({
    share: `\\\\${ip}\\${share}`,
    domain: 'WORKGROUP',
    username: username,
    password: password,
    autoCloseTimeout: 10000,
  });

  // Test connection by reading directory
  await new Promise((resolve, reject) => {
    client.readdir('', (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });

  console.log(`Successfully connected to ${ip}\\${share}`);
  return client;
}

/**
 * Connect to Synology SMB share with retry logic for multiple IPs
 * @param {string[]} ips - Array of IP addresses to try
 * @param {string} share - Share name
 * @param {string} username - SMB username
 * @param {string} password - SMB password
 * @param {string} domain - Domain/Workgroup name (optional, defaults to WORKGROUP)
 * @returns {Promise<{client: SMB2, connectedIp: string}>}
 */
async function connectToSynologyWithFailover(ips, share, username, password, domain) {
  let lastError;

  for (const ip of ips) {
    try {
      const client = new SMB2({
        share: `\\\\${ip}\\${share}`,
        domain: domain || 'WORKGROUP',
        username: username,
        password: password,
        autoCloseTimeout: 10000,
      });

      // Test connection by reading directory
      await new Promise((resolve, reject) => {
        client.readdir('', (err, files) => {
          if (err) reject(err);
          else resolve(files);
        });
      });

      console.log(`Successfully connected to ${ip}\\${share}`);
      return { client, connectedIp: ip };
    } catch (error) {
      console.log(`Failed to connect to ${ip}\\${share}: ${error.message}`);
      lastError = error;
      continue;
    }
  }

  throw new Error(`Failed to connect to any SMB server. Last error: ${lastError?.message}`);
}

/**
 * Get list of files from SMB directory recursively
 * @param {SMB2} client - SMB2 client
 * @param {string} path - Path to read
 * @returns {Promise<string[]>} Array of file paths
 */
async function listFiles(client, path = '') {
  return new Promise((resolve, reject) => {
    client.readdir(path, (err, files) => {
      if (err) {
        reject(err);
        return;
      }

      const filePaths = files
        .filter(file => file !== '.' && file !== '..')
        .map(file => path ? `${path}\\${file}` : file);

      resolve(filePaths);
    });
  });
}

/**
 * Check if file exists on SMB share
 * @param {SMB2} client - SMB2 client
 * @param {string} filePath - File path to check
 * @returns {Promise<boolean>}
 */
async function fileExists(client, filePath) {
  return new Promise((resolve) => {
    client.exists(filePath, (err, exists) => {
      if (err) {
        resolve(false);
      } else {
        resolve(exists);
      }
    });
  });
}

/**
 * Ensure directory exists on SMB share, create if it doesn't
 * @param {SMB2} client - SMB2 client
 * @param {string} dirPath - Directory path to ensure
 * @returns {Promise<void>}
 */
async function ensureDirectory(client, dirPath) {
  return new Promise((resolve, reject) => {
    // Check if directory exists
    client.exists(dirPath, (err, exists) => {
      if (exists) {
        resolve();
        return;
      }

      // Create directory
      client.mkdir(dirPath, (err) => {
        if (err) {
          // Ignore error if directory already exists (race condition)
          if (err.message && err.message.includes('STATUS_OBJECT_NAME_COLLISION')) {
            resolve();
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Copy file from source to target SMB share
 * @param {SMB2} sourceClient - Source SMB2 client
 * @param {SMB2} targetClient - Target SMB2 client
 * @param {string} sourceFilePath - Source file path
 * @param {string} targetFilePath - Target file path
 * @returns {Promise<number>} File size in bytes
 */
async function copyFile(sourceClient, targetClient, sourceFilePath, targetFilePath) {
  return new Promise((resolve, reject) => {
    // Read file from source
    sourceClient.readFile(sourceFilePath, (readErr, content) => {
      if (readErr) {
        reject(new Error(`Failed to read ${sourceFilePath}: ${readErr.message}`));
        return;
      }

      // Write file to target
      targetClient.writeFile(targetFilePath, content, (writeErr) => {
        if (writeErr) {
          reject(new Error(`Failed to write ${targetFilePath}: ${writeErr.message}`));
          return;
        }

        resolve(content.length);
      });
    });
  });
}

/**
 * Format bytes to human readable format
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Backup LV1 MVC_Pictures from source to Synology
 */
export async function backupLv1() {
  const startTime = Date.now();
  let totalCopiedFiles = 0;
  let totalBytes = 0;
  let totalSkippedFiles = 0;
  let usedSynologyIp = null;

  try {
    console.log('Starting LV1 MVC_Pictures backup...');

    // Get configuration from environment
    const synologyIpPrimary = process.env.SYNOLOGY_BACKUP_IP_PRIMARY;
    const synologyIpSecondary = process.env.SYNOLOGY_BACKUP_IP_SECONDARY;
    const synologyDomain = process.env.SYNOLOGY_BACKUP_DOMAIN;
    const synologyUser = process.env.SYNOLOGY_BACKUP_USER;
    const synologyPass = process.env.SYNOLOGY_BACKUP_PASS;

    const sourceIp = process.env.SMB_LV1_SOURCE_IP;
    const sourceShare = process.env.SMB_LV1_SOURCE_SHARE;
    const sourceUser = process.env.SMB_LV1_SOURCE_USER;
    const sourcePass = process.env.SMB_LV1_SOURCE_PASS;

    const targetShare = process.env.SMB_LV1_TARGET_SHARE;
    const targetPath = process.env.SMB_LV1_TARGET_PATH;

    // Validate configuration
    if (!synologyIpPrimary || !synologyUser || !synologyPass) {
      throw new Error('Missing Synology configuration in environment variables');
    }
    if (!sourceIp || !sourceShare || !sourceUser || !sourcePass) {
      throw new Error('Missing source configuration in environment variables');
    }
    if (!targetShare || targetPath === undefined) {
      throw new Error('Missing target configuration in environment variables');
    }

    // Connect to source SMB (standard SMB with WORKGROUP)
    console.log(`Connecting to source: ${sourceIp}\\${sourceShare}`);
    const sourceClient = await connectToSourceSmb(
      sourceIp,
      sourceShare,
      sourceUser,
      sourcePass
    );

    // Connect to target SMB (Synology) with failover
    const synologyIps = [synologyIpPrimary];
    if (synologyIpSecondary) {
      synologyIps.push(synologyIpSecondary);
    }

    console.log(`Connecting to target Synology: ${synologyIps.join(', ')} (domain: ${synologyDomain || 'WORKGROUP'})`);
    const { client: targetClient, connectedIp } = await connectToSynologyWithFailover(
      synologyIps,
      targetShare,
      synologyUser,
      synologyPass,
      synologyDomain
    );
    usedSynologyIp = connectedIp;

    // Get list of all files from source root
    console.log(`Reading files from source...`);
    const sourceFiles = await listFiles(sourceClient, '');
    console.log(`Found ${sourceFiles.length} files in MVC_Pictures`);

    // Process each file
    for (const file of sourceFiles) {
      try {
        // Build target path
        const targetFile = targetPath ? `${targetPath}\\${file}` : file;

        // Check if file already exists in target
        const exists = await fileExists(targetClient, targetFile);

        if (exists) {
          totalSkippedFiles++;
          continue;
        }

        // Copy new file
        console.log(`Copying: ${file} -> ${targetFile}`);
        const fileSize = await copyFile(sourceClient, targetClient, file, targetFile);

        totalCopiedFiles++;
        totalBytes += fileSize;

      } catch (fileError) {
        console.error(`Error processing file ${file}:`, fileError.message);
        // Continue with next file instead of failing entire backup
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const result = {
      backupName: 'LV1_MVC_Pictures',
      copiedFiles: totalCopiedFiles,
      skippedFiles: totalSkippedFiles,
      totalFiles: totalCopiedFiles + totalSkippedFiles,
      totalBytes,
      formattedSize: formatBytes(totalBytes),
      duration: `${duration}s`,
      synologyIp: usedSynologyIp,
    };

    console.log(
      `\nbackupLv1 -> success at ${new Date().toLocaleString()} | ` +
      `Total Copied: ${totalCopiedFiles}, Total Skipped: ${totalSkippedFiles}, ` +
      `Size: ${formatBytes(totalBytes)}, Duration: ${duration}s, Synology: ${usedSynologyIp}`
    );

    // Report to status collector
    statusCollector.addSuccess('backupLv1', result);

    return result;

  } catch (error) {
    console.error('Error in backupLv1:', error);
    throw error;
  }
}
