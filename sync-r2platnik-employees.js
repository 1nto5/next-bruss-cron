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

    const employees = result.recordset.map((row) => ({
      firstName: row.Imie,
      lastName: row.Nazwisko,
      identifier: row.Identyfikator,
    }));

    if (employees.length > 0) {
      const bulkOps = employees.map((emp) => ({
        updateOne: {
          filter: { identifier: emp.identifier },
          update: { $set: emp },
          upsert: true,
        },
      }));

      const bulkResult = await employeesCollection.bulkWrite(bulkOps, {
        ordered: false,
      });

      // Remove employees not present in SQL source
      const currentIdentifiers = employees.map((emp) => emp.identifier);
      await employeesCollection.deleteMany({
        identifier: { $nin: currentIdentifiers },
      });

      const updatedCount =
        (bulkResult.modifiedCount || 0) + (bulkResult.upsertedCount || 0);
    }
  } catch (error) {
    console.error('Error during syncing employees:', error);
  } finally {
    await mongoClient.close();
    await sql.close();
    console.log(
      `syncR2platnikEmployees -> success at ${new Date().toLocaleString()}`
    );
  }
}

export { syncR2platnikEmployees };
