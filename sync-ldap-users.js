import { dbc } from './lib/mongo.js';

import dotenv from 'dotenv'; // Import dotenv
// const LdapClient = require('ldapjs-client');
import LdapClient from 'ldapjs-client'; // Import LdapClient

dotenv.config();

// Removed LdapEntry and SyncResult interfaces

export async function syncLdapUsers() {
  // Removed Promise<SyncResult> type annotation
  const ldapUrl = process.env.LDAP; // Removed non-null assertion (!)
  const adminDn = process.env.LDAP_DN; // Removed non-null assertion (!)
  const adminPass = process.env.LDAP_PASS; // Removed non-null assertion (!)
  const baseDn = process.env.LDAP_BASE_DN; // Removed non-null assertion (!)

  // Add checks for environment variables
  if (!ldapUrl || !adminDn || !adminPass || !baseDn) {
    console.error('Missing required LDAP environment variables');
    throw new Error('Missing required LDAP environment variables');
  }

  const usersColl = await dbc('users');

  const ldapClient = new LdapClient({ url: ldapUrl });
  const fetchedMails = new Set(); // Removed <string> type annotation
  let added = 0;

  try {
    // 1) Bind as LDAP admin
    await ldapClient.bind(adminDn, adminPass);

    // 2) Search for all users
    const options = {
      filter: '(c=PL)',
      scope: 'sub',
      attributes: ['dn', 'mail'],
    };
    const entries = await ldapClient.search(baseDn, options); // Use baseDn and options
    // 3) Insert only new users, do not modify existing ones
    for (const entry of entries) {
      // Iterate over entries directly
      const mail = entry.mail; // Access mail property
      if (!mail) continue; // Skip if mail is missing

      const email = mail.toLowerCase(); // Convert to lowercase immediately
      fetchedMails.add(email);

      const res = await usersColl.updateOne(
        { email }, // Use the lowercase email for querying
        {
          // only on insert
          $setOnInsert: {
            email, // Store the lowercase email
            roles: ['user'],
          },
        },
        { upsert: true }
      );

      if (res.upsertedCount) {
        added++;
      }
    }

    // 4) Optionally remove users not present in LDAP anymore
    const toRemove = []; // Removed string[] type annotation
    await usersColl.find({}, { projection: { email: 1 } }).forEach((doc) => {
      // No change needed here as fetchedMails already contains lowercase emails
      // and we assume emails in the DB are already consistently lowercase (or will be after this sync runs)
      if (doc.email && !fetchedMails.has(doc.email)) {
        // Check if doc.email exists
        toRemove.push(doc.email);
      }
    });

    let removed = 0;
    if (toRemove.length) {
      const delRes = await usersColl.deleteMany({ email: { $in: toRemove } });
      removed = delRes.deletedCount ?? 0;
    }

    await ldapClient.unbind();
    console.log(
      `syncLdapUsers -> success at ${new Date().toLocaleString()} (Added: ${added}, Removed: ${removed})`
    ); // Added log
    return { added, removed };
  } catch (error) {
    try {
      await ldapClient.unbind();
    } catch {}
    console.error('syncLdapUsers error:', error);
    throw error; // Re-throw the error after logging
  }
}
