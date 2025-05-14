import dotenv from 'dotenv';
import cron from 'node-cron';
import { archiveScans } from './archive-scans.js';
import { sendPendingDeviationApprovalNotifications } from './deviations-send-reminders.js';
import { deviationsStatusUpdate } from './deviations-status-update.js';
import { sendPendingProductionOvertimeEmailNotifications } from './production-overtime-mailer.js';
import { syncLdapUsers } from './sync-ldap-users.js';
import { syncR2platnikEmployees } from './sync-r2platnik-employees.js';

dotenv.config();

// Deviations tasks
// -----------------------
// Schedule sending of pending deviation approval notifications every workday at 03:00
cron.schedule('0 3 * * 1-5', sendPendingDeviationApprovalNotifications, {});
// Schedule deviations status update every 2 hours
cron.schedule('0 */2 * * *', deviationsStatusUpdate, {});

// Production overtime tasks
// -------------------------------
// Schedule sending of pending production overtime email notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', sendPendingProductionOvertimeEmailNotifications);

// Data synchronization tasks
// --------------------------
// Schedule synchronization of r2platnik employees at 16:00 every workday
cron.schedule('0 16 * * 1-5', syncR2platnikEmployees);
// Schedule synchronization of LDAP users every workday at 16:00
cron.schedule('0 16 * * 1-5', syncLdapUsers);

// Maintenance tasks
// ----------------
// Schedule archiving of scans every Sunday at 22:00
cron.schedule('0 22 * * 0', archiveScans);
