/**
 * Redirect targets that arrive in a URL (`callbackUrl`, `next`) or are stored
 * with a login request must never leave the site: an attacker could otherwise
 * craft a sign-in link that lands the victim on a look-alike page.
 *
 * Accepts only same-origin relative paths: a single leading "/", no "//"
 * (protocol-relative), no backslash (browsers treat it as "/"), no scheme and
 * no control characters (a tab or newline inside "/\t/evil.com" is dropped by
 * the URL parser and turns it back into "//evil.com").
 */
export function safeRelativePath(input: string | string[] | null | undefined, fallback = "/"): string {
  const value = Array.isArray(input) ? input[0] : input;
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
