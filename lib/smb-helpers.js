import SMB2 from 'v9u-smb2';

/**
 * Connect to source SMB share (standard SMB)
 * @param {string} ip - IP address
 * @param {string} share - Share name
 * @param {string} username - SMB username
 * @param {string} password - SMB password
 * @returns {Promise<SMB2>}
 */
export async function connectToSourceSmb(ip, share, username, password) {
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
export async function connectToSynologyWithFailover(ips, share, username, password, domain) {
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
 * Get list of files from SMB directory
 * @param {SMB2} client - SMB2 client
 * @param {string} path - Path to read
 * @returns {Promise<string[]>} Array of file paths
 */
export async function listFiles(client, path = '') {
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
export async function fileExists(client, filePath) {
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
 * Get file stats (size and modification time) from SMB share
 * @param {SMB2} client - SMB2 client
 * @param {string} filePath - File path
 * @returns {Promise<{size: number, mtime: Date}|null>}
 */
export async function getFileStats(client, filePath) {
  return new Promise((resolve) => {
    client.stat(filePath, (err, stats) => {
      if (err) {
        resolve(null);
      } else {
        resolve({
          size: stats.size,
          mtime: stats.mtime,
        });
      }
    });
  });
}

/**
 * Check if path is a directory
 * @param {SMB2} client - SMB2 client
 * @param {string} path - Path to check
 * @returns {Promise<boolean>}
 */
export async function isDirectory(client, path) {
  return new Promise((resolve) => {
    client.readdir(path, (err, files) => {
      if (err) {
        // If readdir fails, it's likely a file or doesn't exist
        resolve(false);
      } else {
        // If readdir succeeds, it's a directory
        resolve(true);
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
export async function ensureDirectory(client, dirPath) {
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
 * Note: File timestamps cannot be preserved due to SMB2 library limitations
 * @param {SMB2} sourceClient - Source SMB2 client
 * @param {SMB2} targetClient - Target SMB2 client
 * @param {string} sourceFilePath - Source file path
 * @param {string} targetFilePath - Target file path
 * @returns {Promise<number>} File size in bytes
 */
export async function copyFile(sourceClient, targetClient, sourceFilePath, targetFilePath) {
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
 * Recursively copy directory from source to target SMB share
 * @param {SMB2} sourceClient - Source SMB2 client
 * @param {SMB2} targetClient - Target SMB2 client
 * @param {string} sourcePath - Source directory path
 * @param {string} targetPath - Target directory path
 * @returns {Promise<{copiedFiles: number, skippedFiles: number, totalBytes: number}>}
 */
export async function copyDirectoryRecursive(sourceClient, targetClient, sourcePath, targetPath) {
  let copiedFiles = 0;
  let skippedFiles = 0;
  let totalBytes = 0;

  // Ensure target directory exists
  await ensureDirectory(targetClient, targetPath);

  // Get list of items in source directory
  const items = await listFiles(sourceClient, sourcePath);

  for (const item of items) {
    try {
      // Build paths
      const itemName = item.split('\\').pop();
      const sourceItemPath = item;
      const targetItemPath = targetPath ? `${targetPath}\\${itemName}` : itemName;

      // Check if item is a directory
      const isDir = await isDirectory(sourceClient, sourceItemPath);

      if (isDir) {
        // Recursively copy directory
        const stats = await copyDirectoryRecursive(
          sourceClient,
          targetClient,
          sourceItemPath,
          targetItemPath
        );
        copiedFiles += stats.copiedFiles;
        skippedFiles += stats.skippedFiles;
        totalBytes += stats.totalBytes;
      } else {
        // Check if file already exists
        const exists = await fileExists(targetClient, targetItemPath);

        let shouldCopy = !exists;

        if (exists) {
          // File exists - compare modification dates
          const sourceStats = await getFileStats(sourceClient, sourceItemPath);
          const targetStats = await getFileStats(targetClient, targetItemPath);

          if (sourceStats && targetStats) {
            // Copy if source is newer than target
            if (sourceStats.mtime > targetStats.mtime) {
              console.log(`Updating ${itemName}: source newer (${sourceStats.mtime.toISOString()} > ${targetStats.mtime.toISOString()})`);
              shouldCopy = true;
            } else {
              // Source is older or same - skip
              skippedFiles++;
              continue;
            }
          } else {
            // Could not get stats, skip to be safe
            console.log(`Warning: Could not compare stats for ${itemName}, skipping`);
            skippedFiles++;
            continue;
          }
        }

        if (shouldCopy) {
          // Copy file
          const fileSize = await copyFile(sourceClient, targetClient, sourceItemPath, targetItemPath);
          copiedFiles++;
          totalBytes += fileSize;
        }
      }
    } catch (error) {
      console.error(`Error copying ${item}:`, error.message);
      // Continue with next item
    }
  }

  return { copiedFiles, skippedFiles, totalBytes };
}

/**
 * Format bytes to human readable format
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
