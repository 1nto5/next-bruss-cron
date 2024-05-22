import { MongoClient } from "mongodb";
import cron from "node-cron";

const url = "mongodb://localhost:27017"; // Zastąp odpowiednim URL do swojej bazy danych
const dbName = "yourDatabaseName"; // Zastąp odpowiednią nazwą bazy danych

async function archiveOldScans() {
  const client = new MongoClient(url);
  try {
    await client.connect();
    const db = client.db(dbName);
    const scansCollection = db.collection("scans");

    // 1. Mark as archive older than 3 months
    const threeMonthsAgo = new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000);
    await scansCollection.updateMany(
      { time: { $lt: threeMonthsAgo } },
      { $set: { archived: true } }
    );

    // 2. Copy docs with archived: true to scans_archive
    await scansCollection
      .aggregate([{ $match: { archived: true } }, { $out: "scans_archive" }], {
        allowDiskUse: true,
      })
      .toArray();

    // 3. Delete docs with archived: true
    await scansCollection.deleteMany({ archived: true });

    console.log("Archiving old scans completed.");
  } catch (error) {
    console.error("Error during archiving scans:", error);
  } finally {
    await client.close();
  }
}

// Schedule the task to run every two weeks
cron.schedule("0 0 0 */14 * *", archiveOldScans);

export { archiveOldScans };
