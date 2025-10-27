/**
 * Parse email addresses from environment variable
 * Supports both single email and comma-separated list
 * @param {string} emailString - Email address(es) from environment variable
 * @returns {string[]} Array of email addresses
 */
export function parseEmailAddresses(emailString) {
  if (!emailString || typeof emailString !== 'string') {
    return [];
  }

  // Split by comma and trim whitespace from each address
  return emailString
    .split(',')
    .map(email => email.trim())
    .filter(email => email.length > 0);
}
