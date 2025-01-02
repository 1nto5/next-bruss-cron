import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import cron from "node-cron";

dotenv.config();

async function archiveOldScans() {
  if (!process.env.MONGO_URI) {
    throw new Error(
      "Please define the MONGO_URI environment variable inside .env!"
    );
  }
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const scansCollection = db.collection("scans");
    const scansArchiveCollection = db.collection("scans_archive");

    const startTime = new Date(); // Register start time
    console.log(`Archiving started at: ${startTime}`);

    // 1. Mark as archive older than 2 months
    const updateResult = await scansCollection.updateMany(
      { time: { $lt: new Date(Date.now() - 2 * 30 * 24 * 60 * 60 * 1000) } },
      { $set: { archived: true } }
    );
    console.log(`Documents marked as archived: ${updateResult.modifiedCount}`);

    // 2. Copy docs with archived: true to scans_archive and delete them
    let archivedDocs;
    do {
      archivedDocs = await scansCollection
        .find({ archived: true })
        .limit(10000) // Limit to 10000 documents
        .toArray();
      console.log(
        `Documents to be copied to scans_archive: ${archivedDocs.length}`
      );

      if (archivedDocs.length > 0) {
        try {
          await scansArchiveCollection.insertMany(archivedDocs, {
            ordered: false,
          });
          console.log("Documents copied to scans_archive");
        } catch (error) {
          if (error.code === 11000) {
            console.warn("Duplicate key error encountered. Continuing...");
          } else {
            throw error; // re-throw the error if it's not a duplicate key error
          }
        }

        // Delete the copied documents
        const idsToDelete = archivedDocs.map((doc) => doc._id);
        const deleteResult = await scansCollection.deleteMany({
          _id: { $in: idsToDelete },
        });
        console.log(`Documents deleted: ${deleteResult.deletedCount}`);
      }
    } while (archivedDocs.length > 0);

    const endTime = new Date(); // Register end time
    console.log(`Archiving ended at: ${endTime}`);
  } catch (error) {
    console.error("Error during archiving scans:", error);
  } finally {
    await client.close();
  }
}

// Schedule the task to run every day at 22:00
cron.schedule("0 22 * * *", archiveOldScans);

// Export the function (optional, in case you want to call it manually)
export { archiveOldScans };
