/**
 * Check if a publish timestamp is in the future (exact time).
 */
export function isFuturePublishDate(
  publishedAtISO: string,
  _clientToday?: string,
): boolean {
  const publishDate = new Date(publishedAtISO);
  if (Number.isNaN(publishDate.getTime())) return false;
  return publishDate.getTime() > Date.now();
}
