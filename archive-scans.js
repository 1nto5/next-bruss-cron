import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

async function archiveScans() {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'Please define the MONGO_URI environment variable inside .env!'
    );
  }
  const client = new MongoClient(process.env.MONGO_URI);
  let totalSynchronized = 0;
  try {
    await client.connect();
    const db = client.db();
    const scansCollection = db.collection('scans');
    const scansArchiveCollection = db.collection('scans_archive');

    // Mark as archived all documents older than 3 months
    await scansCollection.updateMany(
      { time: { $lt: new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000) } },
      { $set: { archived: true } }
    );

    // Copy docs with archived: true to scans_archive and delete them in batches
    let archivedDocs;
    do {
      archivedDocs = await scansCollection
        .find({ archived: true })
        .limit(10000)
        .toArray();

      if (archivedDocs.length > 0) {
        try {
          await scansArchiveCollection.insertMany(archivedDocs, {
            ordered: false,
          });
        } catch (error) {
          if (error.code === 11000) {
            // Duplicate key error - continue processing
          } else {
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
  } finally {
    await client.close();
  }
}

export { archiveScans };
