import sql from 'mssql';
import { dbc } from './lib/mongo.js';

require('dotenv').config();

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

    if (employees.length > 0) {
      const bulkOps = employees.map((emp) => ({
        updateOne: {
          filter: { identifier: emp.identifier },
          update: { $set: emp },
          upsert: true,
        },
      }));

      await employeesCollection.bulkWrite(bulkOps, { ordered: false });

      const currentIdentifiers = employees.map((emp) => emp.identifier);
      await employeesCollection.deleteMany({
        identifier: { $nin: currentIdentifiers },
      });
    }
  } catch (error) {
    console.error('Error during syncing employees:', error);
  } finally {
    await sql.close();
    console.log(
      `syncR2platnikEmployees -> success at ${new Date().toLocaleString()}`
    );
  }
}

export { syncR2platnikEmployees };
