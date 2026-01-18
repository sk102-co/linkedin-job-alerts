import { deduplicateBy } from '../../src/utils/deduplication';

describe('deduplicateBy', () => {
  it('should deduplicate objects by a string key', () => {
    const items = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '1', name: 'Alice Duplicate' },
      { id: '3', name: 'Charlie' },
    ];

    const result = deduplicateBy(items, (item) => item.id);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '3', name: 'Charlie' },
    ]);
  });

  it('should preserve the first occurrence of duplicates', () => {
    const items = [
      { jobId: 'abc', title: 'First' },
      { jobId: 'abc', title: 'Second' },
      { jobId: 'abc', title: 'Third' },
    ];

    const result = deduplicateBy(items, (item) => item.jobId);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('First');
  });

  it('should return empty array for empty input', () => {
    const result = deduplicateBy([], (item: { id: string }) => item.id);

    expect(result).toEqual([]);
  });

  it('should return all items when there are no duplicates', () => {
    const items = [
      { id: '1', value: 'a' },
      { id: '2', value: 'b' },
      { id: '3', value: 'c' },
    ];

    const result = deduplicateBy(items, (item) => item.id);

    expect(result).toHaveLength(3);
    expect(result).toEqual(items);
  });

  it('should work with complex key extraction', () => {
    const items = [
      { firstName: 'John', lastName: 'Doe' },
      { firstName: 'Jane', lastName: 'Doe' },
      { firstName: 'John', lastName: 'Doe' },
      { firstName: 'John', lastName: 'Smith' },
    ];

    const result = deduplicateBy(
      items,
      (item) => `${item.firstName}-${item.lastName}`
    );

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { firstName: 'John', lastName: 'Doe' },
      { firstName: 'Jane', lastName: 'Doe' },
      { firstName: 'John', lastName: 'Smith' },
    ]);
  });

  it('should handle single item array', () => {
    const items = [{ id: '1', name: 'Only One' }];

    const result = deduplicateBy(items, (item) => item.id);

    expect(result).toHaveLength(1);
    expect(result).toEqual(items);
  });
});
