export function parseEmailContact(email: string): { name: string | null; email: string } {
  const match = email.match(/(.*)<(.*)>/);
  if (match && match.length === 3 && match[1] && match[2]) {
    return {
      name: match[1].trim(),
      email: match[2].trim(),
    };
  }
  return {
    name: null,
    email: email.trim(),
  };
}
