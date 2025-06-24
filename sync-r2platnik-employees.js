import dotenv from 'dotenv';
import sql from 'mssql';
import { dbc } from './lib/mongo.js';

dotenv.config();

async function syncR2platnikEmployees() {
  // Initialize counters
  let processedEmployees = 0;
  let addedEmployees = 0;
  let deletedEmployees = 0;

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

  try {
    const employeesCollection = await dbc('employees');

    await sql.connect(sqlConfig);
    const query =
      'SELECT Imie, Nazwisko, Identyfikator FROM [dbo].[PRACOWNK] WHERE Identyfikator IS NOT NULL AND Skasowany = 0 AND (Data_zwolnienia > GETDATE() OR Data_zwolnienia IS NULL)';
    const result = await sql.query(query);

    const employees = result.recordset.map(
      ({ Imie, Nazwisko, Identyfikator }) => ({
        firstName: Imie,
        lastName: Nazwisko,
        identifier: Identyfikator,
      })
    );

    processedEmployees = employees.length;

    if (employees.length > 0) {
      // Get current employees to determine which ones are new
      const currentEmployees = await employeesCollection
        .find({}, { projection: { identifier: 1 } })
        .toArray();
      const currentIdentifiers = currentEmployees.map((emp) => emp.identifier);

      // Track new employees
      for (const emp of employees) {
        if (!currentIdentifiers.includes(emp.identifier)) {
          addedEmployees++;
        }
      }

      const bulkOps = employees.map((emp) => ({
        updateOne: {
          filter: { identifier: emp.identifier },
          update: { $set: emp },
          upsert: true,
        },
      }));

      await employeesCollection.bulkWrite(bulkOps, { ordered: false });

      // Get count of employees to be deleted (exclude external employees)
      const employeesToDelete = await employeesCollection.countDocuments({
        identifier: { $nin: employees.map((emp) => emp.identifier) },
        external: { $ne: true },
      });

      deletedEmployees = employeesToDelete;

      // Delete employees that no longer exist in R2platnik (but keep external employees)
      if (employeesToDelete > 0) {
        await employeesCollection.deleteMany({
          identifier: { $nin: employees.map((emp) => emp.identifier) },
          external: { $ne: true },
        });
      }
    }
  } catch (error) {
    console.error('Error during syncing employees:', error);
  } finally {
    await sql.close();
    console.log(
      `syncR2platnikEmployees -> success at ${new Date().toLocaleString()} | Processed: ${processedEmployees}, Added: ${addedEmployees}, Deleted: ${deletedEmployees}`
    );
  }
}

export { syncR2platnikEmployees };
