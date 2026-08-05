// Lowercases and trims `domain\username` so uniqueness/lookups don't depend
// on SQL Server collation being case-insensitive.
export function normalizeDomainUsername(domain: string, username: string): string {
  return `${domain}\\${username}`.trim().toLowerCase();
}
