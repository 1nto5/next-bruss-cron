export function extractNameFromEmail(email) {
  let nameParts = email.split('@')[0].split('.');
  const lastName =
    nameParts.length > 1
      ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1)
      : '';
  let firstNameInitial = nameParts[0].charAt(0).toUpperCase() + '.';
  return firstNameInitial + ' ' + lastName;
}
