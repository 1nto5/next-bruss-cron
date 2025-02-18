import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import sql from 'mssql';

dotenv.config();

async function syncR2platnikEmployees() {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'Please define the MONGO_URI environment variable in .env!'
    );
  }
  // SQL connection configuration
  const sqlConfig = {
    user: process.env.R2PLATNIK_SQL_USER,
    password: process.env.R2PLATNIK_SQL_PASSWORD,
    server: process.env.R2PLATNIK_SQL_SERVER,
    database: process.env.R2PLATNIK_SQL_DATABASE,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      instanceName: process.env.R2PLATNIK_SQL_INSTANCE,
    },
  };

  const mongoClient = new MongoClient(process.env.MONGO_URI);
  try {
    await mongoClient.connect();
    const db = mongoClient.db();
    const employeesCollection = db.collection('employees');

    await sql.connect(sqlConfig);
    const query =
      'SELECT Imie, Nazwisko, Identyfikator FROM [dbo].[PRACOWNK] WHERE Skasowany = 0 AND (Data_zwolnienia > GETDATE() OR Data_zwolnienia IS NULL)';
    const result = await sql.query(query);

    console.log(`Fetched ${result.recordset.length} rows from SQL Server`);

    // Create array of employees from SQL result
    const employees = result.recordset.map((row) => ({
      firstName: row.Imie,
      lastName: row.Nazwisko,
      identifier: row.Identyfikator,
    }));

    if (employees.length > 0) {
      // Build bulk operations for upserting records
      const bulkOps = employees.map((emp) => ({
        updateOne: {
          filter: { identifier: emp.identifier },
          update: { $set: emp },
          upsert: true,
        },
      }));

      try {
        await employeesCollection.bulkWrite(bulkOps, { ordered: false });
        console.log('Upserted employee data into MongoDB');
      } catch (error) {
        console.error('Error during bulk upsert:', error);
        throw error;
      }

      // Remove employees that are no longer in the SQL source
      const currentIdentifiers = employees.map((emp) => emp.identifier);
      const deleteResult = await employeesCollection.deleteMany({
        identifier: { $nin: currentIdentifiers },
      });
      if (deleteResult.deletedCount > 0) {
        console.log(
          `Removed ${deleteResult.deletedCount} employees not present in SQL source`
        );
      }
    }
  } catch (error) {
    console.error('Error during syncing employees:', error);
  } finally {
    await mongoClient.close();
    await sql.close();
  }
}
// Schedule the task to run every 30 seconds for testing
cron.schedule('*/30 * * * * *', syncR2platnikEmployees);

// Export the function to be able to call it manually if needed
export { syncR2platnikEmployees };
