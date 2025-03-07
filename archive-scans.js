import { dbc } from './lib/mongo';

require('dotenv').config();

async function archiveScans() {
  let totalSynchronized = 0;

  const THREE_MONTHS_MS = 3 * 30 * 24 * 60 * 60 * 1000;
  const BATCH_SIZE = 10000;
  const thresholdDate = new Date(Date.now() - THREE_MONTHS_MS);

  try {
    const scansCollection = await dbc('scans');
    const scansArchiveCollection = await dbc('scans_archive');

    await scansCollection.updateMany(
      { time: { $lt: thresholdDate } },
      { $set: { archived: true } }
    );

    let archivedDocs;
    do {
      archivedDocs = await scansCollection
        .find({ archived: true })
        .limit(BATCH_SIZE)
        .toArray();

      if (archivedDocs.length > 0) {
        try {
          await scansArchiveCollection.insertMany(archivedDocs, {
            ordered: false,
          });
        } catch (error) {
          if (error.code !== 11000) {
            throw error;
          }
        }

        const idsToDelete = archivedDocs.map((doc) => doc._id);
        const deleteResult = await scansCollection.deleteMany({
          _id: { $in: idsToDelete },
        });
        totalSynchronized += deleteResult.deletedCount;
      }
    } while (archivedDocs.length > 0);

    console.log(
      `archiveScans -> success at ${new Date().toLocaleString()} (${totalSynchronized} archived)`
    );
  } catch (error) {
    console.error('Error during archiving scans:', error);
  }
}

export { archiveScans };
