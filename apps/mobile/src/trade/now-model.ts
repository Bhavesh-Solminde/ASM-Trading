/**
 * What `useNow` returns for one render. `stored` is only refreshed by the interval (and by an effect after
 * paint), so on the very render where ticking resumes it is as old as the pause: read the clock instead.
 */
export function nowForRender(input: { ticking: boolean; wasTicking: boolean; stored: number; clock: () => number }): number {
  return input.ticking && !input.wasTicking ? input.clock() : input.stored;
}
