-- ============================================================================
-- Sehatsandhi — tell PostgREST that sehat_open_windows changed shape
--
-- Run AFTER 0072. Safe to re-run.
--
-- 0072 dropped and recreated sehat_open_windows with an extra result column,
-- `blocked_elsewhere`. PostgREST caches function signatures the same way it
-- caches columns, so until it is told, the RPC keeps returning the old eight
-- columns and src/lib/availability.ts reads `undefined` for the new one —
-- which is falsy, so every window would look bookable again. The database
-- would be right and the API would be wrong, silently.
--
-- Its own migration rather than a line at the end of 0072, for the reason 0061
-- gives: 0072 is applied to both databases and the runner is right to refuse a
-- rewritten history.
-- ============================================================================

notify pgrst, 'reload schema';
