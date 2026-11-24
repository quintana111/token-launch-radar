# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/quintana111/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/quintana111/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for pre-token protocols: it fits a size curve of market cap against TVL on traded comparables, adjusts each estimate for category, growth, seasoning, name siblings and chain breadth, and ranks every eligible protocol with an uncertainty band and a modeled $1,000 farming scenario. All figures are recomputed from a sealed snapshot — nothing here is a launch promise or a guaranteed return.

## Run

```sh
node main.ts --input /path/to/snapshot.json --output /path/to/output
```

With no arguments it reads `/input/snapshot.json` (or `$MAKEFUN_INPUT`) and writes to `/output` (or `$MAKEFUN_OUTPUT_DIR`). Node 22+, standard library only, no dependencies. The output directory gets `board.json`, a static `dashboard/`, `screenshots/`, and `dossier.json`.
