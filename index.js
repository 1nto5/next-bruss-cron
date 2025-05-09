import dotenv from 'dotenv';
import cron from 'node-cron';
import { archiveScans } from './archive-scans.js';
import { sendPendingDeviationApprovalNotifications } from './deviations-send-reminders.js';
import { deviationsStatusUpdate } from './deviations-status-update.js';
import { sendPendingProductionOvertimeEmailNotifications } from './production-overtime-mailer.js';
import { syncLdapUsers } from './sync-ldap-users.js';
import { syncR2platnikEmployees } from './sync-r2platnik-employees.js';

dotenv.config();

// Schedule synchronization of employees at 06:00, 14:00, and 22:00 every day
cron.schedule('0 6,14,22 * * *', syncR2platnikEmployees);

// Schedule archiving of scans every Sunday at 22:00
cron.schedule('0 22 * * 0', archiveScans);

// Schedule sending of pending production overtime email notifications every day at 22:00
cron.schedule('0 22 * * *', sendPendingProductionOvertimeEmailNotifications);

// For testing: Schedule email sending every minute
// cron.schedule('* * * * *', sendPendingProductionOvertimeEmailNotifications, {});

// Schedule synchronization of LDAP users every day at 16:00
cron.schedule('0 16 * * *', syncLdapUsers);

// Schedule synchronization of LDAP users every minute for testing
// cron.schedule('* * * * *', syncLdapUsers, {});

// Schedule deviations status update every day at 03:00
cron.schedule('0 3 * * *', deviationsStatusUpdate, {});
// Schedule deviations status update every minute for testing
// cron.schedule('* * * * *', deviationsStatusUpdate, {});

// Schedule sending of pending deviation approval notifications every day at 03:00
cron.schedule('0 3 * * *', sendPendingDeviationApprovalNotifications, {});
// Schedule sending of pending deviation approval notifications every minute for testing
// cron.schedule('* * * * *', sendPendingDeviationApprovalNotifications, {});
