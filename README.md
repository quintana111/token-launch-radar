# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/quintana111/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/quintana111/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An offline-first launch radar for pre-token DeFi protocols. It estimates scenario values from same-category market-cap/TVL comparables, bounded TVL growth and observed tracking age, then pairs each candidate with risk-aware next steps. No live lookups, airdrop claims, or price predictions.

## Run it

```sh
node --test test/*.test.mjs
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Open `out/dashboard/index.html` locally after the program finishes. It writes a ranked `board.json`, the interactive dashboard and a deterministic `dossier.json` with the three captured states.

---

<sub>Built for [make.fun](https://make.fun/?ref=pr22e52p&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
