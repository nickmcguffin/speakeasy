// Retry timing for the room lookup and room:join: after 1, 2 and 4 seconds, then every 10 seconds.
const firstDelaysMs = [1000, 2000, 4000];
const laterDelayMs = 10_000;

// The "Could not load the room" screen shows only after this many failures in a row. Retries
// go on behind it.
export const failuresBeforeErrorScreen = 3;

export function retryDelayMs(failures: number) {
  return firstDelaysMs[failures - 1] ?? laterDelayMs;
}
