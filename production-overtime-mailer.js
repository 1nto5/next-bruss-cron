import axios from 'axios';
import { dbc } from './lib/mongo';
import { extractNameFromEmail } from './lib/name-format';

require('dotenv').config();

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
        `sendPendingProductionOvertimeEmailNotifications -> success at ${new Date().toLocaleString()} (0 pending requests, 0 emails sent)`
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
        `sendPendingProductionOvertimeEmailNotifications -> success at ${new Date().toLocaleString()} (${totalRequests} pending requests, 0 managers found, 0 emails sent)`
      );
      return;
    }

    totalManagers = plantManagers.length;

    // Send email to each plant manager
    for (const manager of plantManagers) {
      if (!manager.email) {
        continue;
      }

      // Create HTML table with request information
      const tableRows = pendingRequests
        .map((req) => {
          const from = new Date(req.from).toLocaleString(
            process.env.DEFAULT_LOCALE
          );
          const to = new Date(req.to).toLocaleString(
            process.env.DEFAULT_LOCALE
          );

          const hoursBetween =
            (new Date(req.to) - new Date(req.from)) / (1000 * 60 * 60);
          const rbh =
            req.employees && Array.isArray(req.employees)
              ? (hoursBetween * req.employees.length).toFixed(1)
              : 0;
          const requestedAt = new Date(req.requestedAt).toLocaleString(
            process.env.DEFAULT_LOCALE
          );
          const employeesCount =
            req.employees && Array.isArray(req.employees)
              ? req.employees.length
              : 0;

          return `
            <tr>
              <td style="padding: 4px; border: 1px solid #ddd;">${from}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">${to}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">${employeesCount}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">${rbh}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">${
                req.reason
              }</td>
              <td style="padding: 4px; border: 1px solid #ddd;">${requestedAt}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">${extractNameFromEmail(
                req.requestedBy
              )}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">
                <a href="${process.env.APP_URL}/production-overtime/${req._id}" 
                   style="background-color: #4CAF50; color: white; padding: 6px 10px; 
                   text-align: center; text-decoration: none; display: inline-block; border-radius: 4px;">
                  Otwórz zlecenie
                </a>
              </td>
            </tr>
          `;
        })
        .join('');

      // Create HTML table
      const requestTable = `
        <table style="border-collapse: collapse; width: 100%; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 12px; border: 1px solid #ddd;">Od</th>
                <th style="padding: 12px; border: 1px solid #ddd;">Do</th>
                <th style="padding: 12px; border: 1px solid #ddd;">Pracownicy</th>
                <th style="padding: 12px; border: 1px solid #ddd;">RBH</th>
              <th style="padding: 12px; border: 1px solid #ddd;">Uzasadnienie</th>
              <th style="padding: 12px; border: 1px solid #ddd;">Zlecenie wystawione</th>
              <th style="padding: 12px; border: 1px solid #ddd;">Wystawił</th>
              <th style="padding: 12px; border: 1px solid #ddd;">Akcja</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      `;

      // Prepare email content
      const subject =
        'Oczekujące zlecania wykonania pracy w godzinach nadliczbowych - produkcja';
      const html = `
        ${requestTable}
      `;

      try {
        // Use the API to send email
        let apiUrlBase;
        if (!process.env.API_URL) {
          throw new Error('API environment variable is not defined');
        }
        apiUrlBase = process.env.API_URL;
        const apiUrl = new URL(`${apiUrlBase}/send-mail`);
        apiUrl.searchParams.append('to', manager.email);
        apiUrl.searchParams.append('subject', subject);
        apiUrl.searchParams.append('html', html);

        await axios.get(apiUrl.toString());
        emailsSent++;
      } catch (error) {
        emailErrors++;
      }
    }
  } catch (error) {
    console.error('Error in sendOvertimeNotifications:', error);
  }

  console.log(
    `sendPendingProductionOvertimeEmailNotifications -> success at ${new Date().toLocaleString()} (${totalRequests} pending requests, ${totalManagers} managers, ${emailsSent} emails sent, ${emailErrors} errors)`
  );
}

export { sendPendingProductionOvertimeEmailNotifications };
