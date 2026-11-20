-- Bot-vs-bot fills were only ever written, never read by the product (the
-- on-screen tape is held in memory). The engine stopped writing them in the
-- previous release; dropping the table frees about 8.7 GB in production.
DROP TABLE IF EXISTS "MarketExecution";
