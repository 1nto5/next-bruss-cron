import axios from 'axios';
import dotenv from 'dotenv';
import { dbc } from './lib/mongo.js';

dotenv.config();

const ROLE_TRANSLATIONS = {
  'group-leader': 'Group Leader',
  'quality-manager': 'Kierownik Jakości',
  'production-manager': 'Kierownik Produkcji',
  'plant-manager': 'Dyrektor Zakładu',
};

// Helper function to create email content
function createEmailContent(message, deviationUrl) {
  return `
    <div>
      <p>${message}</p>
      <p>
        <a href="${deviationUrl}" style="display:inline-block;padding:10px 20px;font-size:16px;color:white;background-color:#007bff;text-decoration:none;border-radius:5px;">Przejdź do odchylenia</a>
      </p>
    </div>`;
}

async function sendPendingDeviationApprovalNotifications() {
  const deviationsColl = await dbc('deviations');
  const usersColl = await dbc('users');

  const now = new Date();
  const threshold = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 72h ago

  const pendingDeviations = await deviationsColl
    .find({
      status: 'in approval',
      createdAt: { $lte: threshold },
    })
    .toArray();

  if (pendingDeviations.length === 0) {
    console.log(
      `sendPendingDeviationApprovalNotifications -> processed: 0, reminders sent: 0 at ${now.toLocaleDateString()}`
    );
    return;
  }

  let remindersSent = 0;

  for (const deviation of pendingDeviations) {
    // Array to collect notification logs for this deviation
    const notificationLogs = [];

    const deviationUrl = `${process.env.APP_URL}/deviations/${deviation._id}`;
    const approvalMap = {
      'group-leader': deviation.groupLeaderApproval,
      'quality-manager': deviation.qualityManagerApproval,
      'production-manager': deviation.productionManagerApproval,
    };

    const lastApprovalTime = [
      deviation.groupLeaderApproval?.at,
      deviation.qualityManagerApproval?.at,
      deviation.productionManagerApproval?.at,
    ]
      .filter(Boolean)
      .map((d) => new Date(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const plantManagerShouldBeNotified =
      Object.values(approvalMap).every((a) => a?.approved === true) &&
      lastApprovalTime &&
      lastApprovalTime <= threshold;

    if (plantManagerShouldBeNotified) {
      const plantManagers = await usersColl
        .find({ roles: 'plant-manager' })
        .toArray();

      for (const pm of plantManagers) {
        if (!pm.email) continue;

        const subject = `Odchylenie [${deviation.internalId}] - oczekuje na zatwierdzenie (Dyrektor Zakładu)`;
        const message = `Odchylenie [${deviation.internalId}] zostało zatwierdzone przez wszystkie inne stanowiska i czeka ponad 72h na zatwierdzenie przez Dyrektora Zakładu.`;
        const html = createEmailContent(message, deviationUrl);

        try {
          const apiUrl = new URL(`${process.env.API_URL}/mailer`);
          apiUrl.searchParams.append('to', pm.email);
          apiUrl.searchParams.append('subject', subject);
          apiUrl.searchParams.append('html', html);
          await axios.get(apiUrl.toString());

          // Log the notification
          notificationLogs.push({
            to: pm.email,
            sentAt: new Date(),
            type: 'reminder-plant-manager',
          });

          remindersSent++;
        } catch (e) {
          console.error(`Error sending plant manager reminder:`, e);
        }
      }
    }

    for (const [role, approval] of Object.entries(approvalMap)) {
      if (approval?.approved !== undefined) continue; // already decided

      if (role === 'group-leader') {
        const targetRole = `group-leader-${deviation.area}`;
        const groupLeaders = await usersColl
          .find({ roles: { $all: ['group-leader', targetRole] } })
          .toArray();

        if (groupLeaders.length === 0) {
          // vacancy, notify plant manager
          const managers = await usersColl
            .find({ roles: 'plant-manager' })
            .toArray();
          for (const pm of managers) {
            if (!pm.email) continue;
            const subject = `Odchylenie [${deviation.internalId}] - oczekuje na zatwierdzenie (wakat ${ROLE_TRANSLATIONS[role]})`;
            const message = `Odchylenie [${
              deviation.internalId
            }] oczekuje ponad 72h na zatwierdzenie. Powiadomienie wysłano do Dyrektora Zakładu z powodu wakatu na stanowisku: ${
              ROLE_TRANSLATIONS[role]
            } dla obszaru: ${
              deviation.area === 'coating'
                ? 'powlekanie'
                : deviation.area.toUpperCase()
            }.`;
            const html = createEmailContent(message, deviationUrl);
            try {
              const apiUrl = new URL(`${process.env.API_URL}/mailer`);
              apiUrl.searchParams.append('to', pm.email);
              apiUrl.searchParams.append('subject', subject);
              apiUrl.searchParams.append('html', html);
              await axios.get(apiUrl.toString());

              // Log the notification
              notificationLogs.push({
                to: pm.email,
                sentAt: new Date(),
                type: `reminder-vacancy-${role}`,
              });

              remindersSent++;
            } catch (e) {
              console.error(`Error sending vacancy mail to PM:`, e);
            }
          }
          continue;
        }

        for (const user of groupLeaders) {
          if (!user.email) continue;
          const subject = `Odchylenie [${deviation.internalId}] - oczekuje na zatwierdzenie (${ROLE_TRANSLATIONS[role]})`;
          const message = `Odchylenie [${deviation.internalId}] oczekuje ponad 72h na zatwierdzenie w roli: ${ROLE_TRANSLATIONS[role]}.`;
          const html = createEmailContent(message, deviationUrl);
          try {
            const apiUrl = new URL(`${process.env.API_URL}/mailer`);
            apiUrl.searchParams.append('to', user.email);
            apiUrl.searchParams.append('subject', subject);
            apiUrl.searchParams.append('html', html);
            await axios.get(apiUrl.toString());

            // Log the notification
            notificationLogs.push({
              to: user.email,
              sentAt: new Date(),
              type: `reminder-${role}`,
            });

            remindersSent++;
          } catch (e) {
            console.error(`Error sending reminder mail to GL:`, e);
          }
        }
      } else {
        const usersWithRole = await usersColl.find({ roles: role }).toArray();

        if (usersWithRole.length === 0) {
          // vacancy, notify plant manager
          const managers = await usersColl
            .find({ roles: 'plant-manager' })
            .toArray();
          for (const pm of managers) {
            if (!pm.email) continue;
            const subject = `Odchylenie [${deviation.internalId}] - oczekuje na zatwierdzenie (wakat ${ROLE_TRANSLATIONS[role]})`;
            const message = `Odchylenie [${deviation.internalId}] oczekuje ponad 72h na zatwierdzenie. Powiadomienie wysłano do Dyrektora Zakładu z powodu wakatu na stanowisku: ${ROLE_TRANSLATIONS[role]}.`;
            const html = createEmailContent(message, deviationUrl);
            try {
              const apiUrl = new URL(`${process.env.API_URL}/mailer`);
              apiUrl.searchParams.append('to', pm.email);
              apiUrl.searchParams.append('subject', subject);
              apiUrl.searchParams.append('html', html);
              await axios.get(apiUrl.toString());

              // Log the notification
              notificationLogs.push({
                to: pm.email,
                sentAt: new Date(),
                type: `reminder-vacancy-${role}`,
              });

              remindersSent++;
            } catch (e) {
              console.error(`Error sending vacancy mail to PM:`, e);
            }
          }
          continue;
        }

        for (const user of usersWithRole) {
          if (!user.email) continue;
          const subject = `Odchylenie [${deviation.internalId}] - oczekuje na zatwierdzenie (${ROLE_TRANSLATIONS[role]})`;
          const message = `Odchylenie [${deviation.internalId}] oczekuje ponad 72h na zatwierdzenie w roli: ${ROLE_TRANSLATIONS[role]}.`;
          const html = createEmailContent(message, deviationUrl);
          try {
            const apiUrl = new URL(`${process.env.API_URL}/mailer`);
            apiUrl.searchParams.append('to', user.email);
            apiUrl.searchParams.append('subject', subject);
            apiUrl.searchParams.append('html', html);
            await axios.get(apiUrl.toString());

            // Log the notification
            notificationLogs.push({
              to: user.email,
              sentAt: new Date(),
              type: `reminder-${role}`,
            });

            remindersSent++;
          } catch (e) {
            console.error(`Error sending reminder mail to ${role}:`, e);
          }
        }
      }
    }

    // Update the deviation with notification logs if any were sent
    if (notificationLogs.length > 0) {
      try {
        await deviationsColl.updateOne(
          { _id: deviation._id },
          { $push: { notificationLogs: { $each: notificationLogs } } }
        );
      } catch (e) {
        console.error(
          `Error updating notification logs for deviation ${deviation._id}:`,
          e
        );
      }
    }
  }

  console.log(
    `sendPendingDeviationApprovalNotifications -> processed: ${
      pendingDeviations.length
    }, reminders sent: ${remindersSent} at ${now.toLocaleDateString()}`
  );
}

export { sendPendingDeviationApprovalNotifications };
