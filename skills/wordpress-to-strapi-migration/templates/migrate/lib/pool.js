/**
 * A small concurrency pool.
 *
 * Entries migrate one at a time, so their media uploads one file at a time —
 * 204 sequential round-trips on the Neuros run, and an afternoon of waiting on a
 * site with thousands of images. Nearly all of that time is spent waiting on
 * somebody else's server, which is the cheapest kind of work to overlap.
 *
 * It keeps the two guarantees the sequential loop gave away for free: results
 * come back in the order they went in, and when something throws, no new work
 * starts. The second matters because the alternative — pressing on through a
 * failing Strapi — turns one error into hundreds.
 */

export async function mapPool(items, limit, fn) {
  const list = [...items];
  const results = new Array(list.length);
  const size = Math.max(1, Math.min(limit || 1, list.length));

  let next = 0;
  let failure = null;

  const worker = async () => {
    while (!failure) {
      const index = next++;
      if (index >= list.length) return;
      try {
        results[index] = await fn(list[index], index);
      } catch (err) {
        failure ??= err;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: size }, worker));
  if (failure) throw failure;
  return results;
}
