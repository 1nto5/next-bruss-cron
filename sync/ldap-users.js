import { dbc } from '../lib/mongo.js';
const LdapClientModule = await import('ldapjs-client');
const LdapClient = LdapClientModule.default || LdapClientModule;

export async function syncLdapUsers() {
  const ldapClient = new LdapClient({
    url: process.env.LDAP,
    timeout: 30000,
    connectTimeout: 10000,
  });

  // Initialize counters
  let addedUsers = 0;
  let deletedUsers = 0;
  let processedUsers = 0;

  try {
    // Bind to LDAP server
    await ldapClient.bind(process.env.LDAP_DN, process.env.LDAP_PASS);

    const usersCollection = await dbc('users');

    // Keep track of active LDAP users for cleanup later
    const activeEmails = new Set();

    // Single search with PL filter
    const options = {
      filter: '(&(mail=*)(c=PL))',
      scope: 'sub',
      attributes: ['mail', 'dn', 'cn'],
    };

    const searchResults = await ldapClient.search(
      process.env.LDAP_BASE_DN,
      options
    );

    processedUsers = searchResults.length;

    // Process search results
    for (const ldapUser of searchResults) {
      if (ldapUser.mail) {
        const email = Array.isArray(ldapUser.mail)
          ? ldapUser.mail[0].toLowerCase()
          : ldapUser.mail.toLowerCase();

        // Add to active emails set
        activeEmails.add(email);

        // Check if user exists, if not create with default role
        const user = await usersCollection.findOne({ email });
        if (!user) {
          await usersCollection.insertOne({
            email,
            roles: ['user'],
            lastSyncedAt: new Date(),
            displayName: ldapUser.cn || email,
          });
          addedUsers++;
        } else {
          // Update last synced timestamp
          await usersCollection.updateOne(
            { email },
            { $set: { lastSyncedAt: new Date() } }
          );
        }
      }
    }

    // Remove users who no longer exist in LDAP
    if (activeEmails.size > 0) {
      try {
        // Get all users from the database
        const allUsers = await usersCollection.find({}).toArray();

        // Find users that need to be removed (not in active set)
        const usersToRemove = allUsers.filter(
          (user) => !activeEmails.has(user.email)
        );

        if (usersToRemove.length > 0) {
          // Remove users that no longer exist in LDAP
          for (const userToRemove of usersToRemove) {
            await usersCollection.deleteOne({ email: userToRemove.email });
            deletedUsers++;
          }
        }
      } catch (cleanupError) {
        console.error('Error during cleanup of inactive users:', cleanupError);
        throw cleanupError; // Re-throw to allow executeWithErrorNotification to handle it
      }
    }
  } catch (error) {
    console.error('Error during syncing LDAP users:', error);
    throw error; // Re-throw to allow executeWithErrorNotification to handle it
  } finally {
    // Always close the connection properly
    try {
      await ldapClient.unbind();
    } catch (unbindError) {
      // Check if this is just a "Connection closed" error which can be ignored
      if (unbindError.lde_message !== 'Connection closed') {
        console.error(
          'Unexpected error while unbinding LDAP connection:',
          unbindError
        );
      }
    }
    console.log(
      `syncLdapUsers -> success at ${new Date().toLocaleString()} | Processed: ${processedUsers}, Added: ${addedUsers}, Deleted: ${deletedUsers}`
    );
  }
}

