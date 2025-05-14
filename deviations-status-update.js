import dotenv from 'dotenv';
import { dbc } from './lib/mongo.js';

dotenv.config();

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function deviationsStatusUpdate() {
  try {
    const deviationsCollection = await dbc('deviations');
    const today = stripTime(new Date()); // Dzisiejsza data bez czasu

    // Create date objects for start and end of today
    const startOfToday = new Date(today);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    // 1. Ustaw na 'in progress' jeśli today mieści się w zakresie i status to 'approved'
    const result1 = await deviationsCollection.updateMany(
      {
        status: 'approved',
        'timePeriod.from': { $lte: endOfToday },
        'timePeriod.to': { $gte: startOfToday },
      },
      { $set: { status: 'in progress' } }
    );

    // 2. Ustaw na 'closed' jeśli today jest po 'to' i status to 'approved' lub 'in progress'
    const result2 = await deviationsCollection.updateMany(
      {
        status: { $in: ['approved', 'in progress'] },
        'timePeriod.to': { $lt: startOfToday },
      },
      { $set: { status: 'closed' } }
    );

    console.log(
      `deviationsStatusUpdate -> success at ${new Date().toLocaleString()} | InProgress: ${
        result1.modifiedCount
      }, Closed: ${result2.modifiedCount}`
    );
  } catch (error) {
    console.error('Error updating deviation statuses:', error);
  }
}

export { deviationsStatusUpdate };
