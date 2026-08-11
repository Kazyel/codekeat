export function isAllowedGithubAccount(
  accountLogin: string,
  allowedAccounts: ReadonlySet<string>,
): boolean {
  return allowedAccounts.has(accountLogin.toLowerCase());
}
