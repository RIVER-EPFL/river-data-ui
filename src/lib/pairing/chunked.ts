/** Updates split into requests that each stay under the API's body limit. */
export function chunked<T>(items: T[], size = 5000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
