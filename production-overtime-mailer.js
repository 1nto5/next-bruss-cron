import axios from 'axios';
import dotenv from 'dotenv';
import { dbc } from './lib/mongo.js';

dotenv.config();

/**
 * Sends email notifications to plant managers about pending overtime requests
 */
async function sendPendingProductionOvertimeEmailNotifications() {
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
      const html = `
        <div>
          <p style="padding-bottom: 20px;">Masz ${pendingRequests.length} ${
        pendingRequests.length === 1
          ? 'oczekujące zlecenie'
          : 'oczekujące zlecenia'
      } wykonania pracy w godzinach nadliczbowych - produkcja.</p>
          <p>
        <a href="${process.env.APP_URL}/production-overtime" 
           style="background-color: #4CAF50; color: white; padding: 10px 15px; 
           text-align: center; text-decoration: none; display: inline-block; 
           border-radius: 4px; font-weight: bold; margin-top: 10px;">
          Przejdź do zleceń
        </a>
          </p>
        </div>
      `;

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

export { sendPendingProductionOvertimeEmailNotifications };
