# Chart smoothness checklist

User preference: use these six checks for future chart work. Preserve all
simulation ticks, matched orders and settlement outcomes. Performance changes
must reduce display/transport cost without changing the market behavior.

1. **Incremental candles and volume.** Load full history initially or on market /
   timeframe changes; then update only revised and appended bars. Keep the
   reference line in place. Use bounded visual buffering so history retention
   does not force a full chart reload every minute. Preserve pan and zoom.
2. **Stable interface elements.** Create watchlist, depth and tape rows once;
   patch changed values. Coalesce renders with requestAnimationFrame, cache
   number/date formatters and throttle secondary work. Suspend hidden-tab
   rendering/subscriptions while the simulation keeps running.
3. **Small updates and cheap snapshots.** Bootstrap history once, then stream
   selected-market deltas and compact watchlist changes. Summary APIs must not
   build full histories/books. Resume with a validated cursor and worker ID;
   reset fully after a worker generation change. Enforce backpressure.
4. **Immediate, safe switching.** Keep a bounded recent-market cache (six in the
   current lab). Cancel superseded fetches/streams and ignore stale callbacks
   with generation tokens. Never let an old response overwrite a new selection.
5. **Background simulation.** Put expensive simulation work in a worker. Break
   fast-forward into bounded chunks with progress and yields, retaining every
   tick. Freeze the reference set for a manual jump. Verify exact equivalence
   with direct advancement using identical seeds and frozen inputs.
6. **Measure and verify.** Compare payload sizes, latency and event-loop delay.
   Test normal/300× playback, one-hour jumps, market switching and long sessions.
   Instrument local render time, frame intervals, long tasks and switch latency.
   Keep measurements bounded and downloadable. DOM tests are not browser FPS
   benchmarks; state clearly when direct browser profiling is unavailable.

Targets to check on the actual device: redraw p95 below 16 ms, no repeated
>50 ms UI tasks, cached switches within one frame, and responsive HTTP while
fast-forward runs. Targets are not guaranteed measurements.

The website integration uses `apps/web/src/components/chart/`, the external
market store in `apps/web/src/components/shell/market-store.ts`, and the worker /
transport in `apps/engine/src/otc/`. The prototype remains available in the
`codex/otc-market-prototype` worktree at `demos/otc-market/multi-market/`.
Apply the six checks above to both implementations and future chart changes.
