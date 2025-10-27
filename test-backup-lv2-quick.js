import { backupLv2 } from './smb-backup-lv2.js';

console.log('=================================');
console.log('Testing LV2 Zasoby Backup (Quick)');
console.log('=================================\n');

console.log('Configuration:');
console.log(`- Source: ${process.env.SMB_LV2_SOURCE_IP}\\${process.env.SMB_LV2_SOURCE_SHARE}\\${process.env.SMB_LV2_SOURCE_PATH}`);
console.log(`- Target Synology Primary: ${process.env.SYNOLOGY_BACKUP_IP_PRIMARY}\\${process.env.SMB_LV2_TARGET_SHARE}\\${process.env.SMB_LV2_TARGET_PATH}`);
if (process.env.SYNOLOGY_BACKUP_IP_SECONDARY) {
  console.log(`- Target Synology Secondary: ${process.env.SYNOLOGY_BACKUP_IP_SECONDARY}\\${process.env.SMB_LV2_TARGET_SHARE}\\${process.env.SMB_LV2_TARGET_PATH}`);
}
console.log(`- Synology User: ${process.env.SYNOLOGY_BACKUP_USER}`);
console.log(`- Synology Domain: ${process.env.SYNOLOGY_BACKUP_DOMAIN || 'WORKGROUP'}\n`);

console.log('Starting backup test...\n');

try {
  const result = await backupLv2();
  console.log('\n✅ Backup completed successfully!');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('\n❌ Backup failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
