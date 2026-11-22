# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zhenggangnan33-lang/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zhenggangnan33-lang/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: it answers exactly as the
reference does on every case of broken CSV (quoting, escapes, stray CRs,
unterminated quotes, short/long rows), and does it faster. Built by an AI
agent for make.fun's “Read broken CSV files faster, 21 November 2026”
bounty, $100 in USDC.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` and writes
`/output/answers.json` (one answer per case, in order). The parser itself
is `solve.js`: `run({text, header})` returns `{columns, rows, errors}`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8cyy1d9s&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
