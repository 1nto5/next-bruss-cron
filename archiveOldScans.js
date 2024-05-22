import { MongoClient } from "mongodb";
import cron from "node-cron";
import dotenv from "dotenv";

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

    // 1. Mark as archive older than 1 month
    const updateResult = await scansCollection.updateMany(
      { time: { $lt: new Date(Date.now() - 1 * 30 * 24 * 60 * 60 * 1000) } },
      { $set: { archived: true } }
    );
    console.log(`Documents marked as archived: ${updateResult.modifiedCount}`);

    // 2. Copy docs with archived: true to scans_archive
    const archivedDocs = await scansCollection
      .find({ archived: true })
      .toArray();
    console.log(
      `Documents to be copied to scans_archive: ${archivedDocs.length}`
    );

    if (archivedDocs.length > 0) {
      await scansCollection
        .aggregate(
          [{ $match: { archived: true } }, { $out: "scans_archive" }],
          {
            allowDiskUse: true,
          }
        )
        .toArray();
      console.log("Documents copied to scans_archive");
    }

    // 3. Delete docs with archived: true
    const deleteResult = await scansCollection.deleteMany({ archived: true });
    console.log(`Documents deleted: ${deleteResult.deletedCount}`);

    console.log("Archiving old scans completed.");
  } catch (error) {
    console.error("Error during archiving scans:", error);
  } finally {
    await client.close();
  }
}

archiveOldScans();

// Schedule the task to run every day at 22:00
cron.schedule("0 22 * * *", archiveOldScans);

// Export the function (optional, in case you want to call it manually)
export { archiveOldScans };
