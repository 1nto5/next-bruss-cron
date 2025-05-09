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

    // 1. Ustaw na 'in progress' jeśli today mieści się w zakresie i status to 'approved'
    const result1 = await deviationsCollection.updateMany(
      {
        status: 'approved',
        'timePeriod.from': { $lte: today },
        'timePeriod.to': { $gte: today },
      },
      { $set: { status: 'in progress' } }
    );

    // 2. Ustaw na 'closed' jeśli today jest po 'to' i status to 'approved' lub 'in progress'
    const result2 = await deviationsCollection.updateMany(
      {
        status: { $in: ['approved', 'in progress'] },
        'timePeriod.to': { $lt: today },
      },
      { $set: { status: 'closed' } }
    );

    console.log(
      `updateDeviationStatuses -> in progress: ${
        result1.modifiedCount
      }, closed: ${result2.modifiedCount} at ${today.toLocaleDateString()}`
    );
  } catch (error) {
    console.error('Error updating deviation statuses:', error);
  }
}

export { deviationsStatusUpdate };
