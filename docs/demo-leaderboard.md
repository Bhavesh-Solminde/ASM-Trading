# Leaderboard examples

`LEADERBOARD_MODE=demo` displays labeled examples below the daily live standings
in the leaderboard table. The standings and `/api/leaderboard` rank actual LIVE-account
results, excluding bots. The viewer's rank comes from the live standings.

The example rows use a roster of 60 fictional names with sample markets,
profits, losses and returns. The daily results change at midnight India time
and repeat every 60 days. P&L is shown in the viewer's display currency.
The simulation runs on page load from display data and requires no account seed,
migration or scheduled job. Previously seeded bot accounts remain excluded from
the live standings.

The deployment Compose stack defaults to `demo`. Set `LEADERBOARD_MODE=live`
in the deployment environment to display only live standings. For local
development, set `LEADERBOARD_MODE=demo` when starting the web app to see the
examples.
