export async function runBoundedWorkers(items, worker, concurrency = 8) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (typeof worker !== "function") throw new TypeError("worker must be a function");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, concurrency);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}
