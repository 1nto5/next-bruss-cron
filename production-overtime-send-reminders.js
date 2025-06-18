import axios from 'axios';
import dotenv from 'dotenv';
import { dbc } from './lib/mongo.js';

dotenv.config();

// Helper function to create email content
function createEmailContent(message, overtimeUrl) {
  return `
    <div>
      <p>${message}</p>
      <p>
        <a href="${overtimeUrl}" style="display:inline-block;padding:10px 20px;font-size:16px;color:white;background-color:#007bff;text-decoration:none;border-radius:5px;">Przejdź do zleceń</a>
      </p>
    </div>`;
}

/**
 * Sends email notifications to plant managers about pending overtime requests
 */
async function sendPendingOvertimeRequestsApprovalNotifications() {
  let totalRequests = 0;
  let totalManagers = 0;
  let emailsSent = 0;
  let emailErrors = 0;

  try {
    const coll = await dbc('production_overtime');

    // Find pending overtime requests
    const pendingRequests = await coll.find({ status: 'pending' }).toArray();

    if (pendingRequests.length === 0) {
      console.log(
        `sendPendingProductionOvertimeEmailNotifications -> success at ${new Date().toLocaleString()} | Pending: 0, Emails: 0`
      );
      return;
    }

    totalRequests = pendingRequests.length;

    const usersColl = await dbc('users');

    // Find plant managers
    const plantManagers = await usersColl
      .find({ roles: { $in: ['plant-manager'] } })
      .toArray();

    if (plantManagers.length === 0) {
      console.log(
        `sendPendingProductionOvertimeEmailNotifications -> success at ${new Date().toLocaleString()} | Pending: ${totalRequests}, Managers: 0, Emails: 0`
      );
      return;
    }

    totalManagers = plantManagers.length;

    // Send email to each plant manager
    for (const manager of plantManagers) {
      if (!manager.email) {
        continue;
      }

      // Prepare simple email content with count and link
      const subject =
        'Oczekujące zlecania wykonania pracy w godzinach nadliczbowych - produkcja';
      const message = `Masz ${pendingRequests.length} ${
        pendingRequests.length === 1
          ? 'oczekujące zlecenie'
          : 'oczekujące zlecenia'
      } wykonania pracy w godzinach nadliczbowych - produkcja.`;
      const overtimeUrl = `${process.env.APP_URL}/production-overtime`;
      const html = createEmailContent(message, overtimeUrl);

      try {
        // Use the API to send email
        let apiUrlBase;
        if (!process.env.API_URL) {
          throw new Error('API environment variable is not defined');
        }
        apiUrlBase = process.env.API_URL;
        const apiUrl = new URL(`${apiUrlBase}/mailer`);
        apiUrl.searchParams.append('to', manager.email);
        apiUrl.searchParams.append('subject', subject);
        apiUrl.searchParams.append('html', html);

        await axios.get(apiUrl.toString());
        emailsSent++;
      } catch (error) {
        console.error(`Error sending email:`, error);
        emailErrors++;
      }
    }
  } catch (error) {
    console.error('Error in sendOvertimeNotifications:', error);
  }

  console.log(
    `sendPendingProductionOvertimeEmailNotifications -> success at ${new Date().toLocaleString()} | Pending: ${totalRequests}, Managers: ${totalManagers}, Emails: ${emailsSent}, Errors: ${emailErrors}`
  );
}

export { sendPendingOvertimeRequestsApprovalNotifications };
