/**
 * @module utils/deduplication
 *
 * Shared utility for deduplicating arrays by a key property.
 */

/**
 * Deduplicates an array of objects by a specified key.
 * Preserves the first occurrence of each unique key value.
 *
 * @param items - Array of objects to deduplicate
 * @param keyFn - Function to extract the deduplication key from each item
 * @returns Array with duplicates removed
 *
 * @example
 * ```typescript
 * const jobs = [{ jobId: '1', title: 'A' }, { jobId: '1', title: 'B' }, { jobId: '2', title: 'C' }];
 * const unique = deduplicateBy(jobs, job => job.jobId);
 * // Result: [{ jobId: '1', title: 'A' }, { jobId: '2', title: 'C' }]
 * ```
 */
export function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}
