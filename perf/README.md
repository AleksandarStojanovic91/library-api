# Performance tests (k6)

Two [k6](https://grafana.com/docs/k6/latest/) scripts, run against either implementation with `BASE_URL`.

| Script | Load model | What it covers | Pass criteria |
|---|---|---|---|
| `smoke.js` | 1 virtual user for 30 s | health, book list + second page, book by id, full-text and typo search, one borrow → idempotent replay → return per iteration | p95 < 300 ms, failed requests < 1 %, checks > 99 % |
| `load.js` | ramping **arrival rate** (open model): 1 min ramp-up, 3 min steady, 30 s ramp-down | `GET /books` 30/s, `GET /books/{id}` 50/s, search 15/s, borrow/replay/return 5 cycles/s (at `SCALE=1`) | the same, per endpoint, plus fewer than 10 dropped iterations |

`lib/common.js` holds the shared pieces: login, test data setup (a few books with many copies, members with
`maxActiveLoans: 10`), the borrow cycle with a fresh `Idempotency-Key`, the thresholds and the summary writer.

## Before you run

- The service must be up and seeded (`make up` from the repo root).
- **Rate limit.** The default is 120 requests per minute per client, and every anonymous k6 request comes from
  the same IP. `make up` uses `docker-compose.test.yml`, which sets `RATE_LIMIT_PER_MINUTE=100000` on both
  services. Against a stack started without it, almost everything would be a 429.
- Each run adds a few books, copies and members to the database (setup data). That is harmless.

## Run with Docker (no local install)

From the repository root:

```bash
# smoke, Java
docker run --rm -i --network host --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  -e BASE_URL=http://localhost:8081 grafana/k6:2.3.0 run perf/smoke.js

# load, TypeScript, twice the default rates, 5 minute steady state
docker run --rm -i --network host --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  -e BASE_URL=http://localhost:8082 -e SCALE=2 -e HOLD=5m grafana/k6:2.3.0 run perf/load.js
```

Or `make perf-smoke` (both implementations) and `make perf-load IMPL=ts SCALE=2`.

`--network host` lets the container reach `localhost:8081`. On Docker Desktop (macOS/Windows) host networking
must be enabled in Settings → Resources → Network; otherwise drop `--network host` and use
`-e BASE_URL=http://host.docker.internal:8081`. `--user` makes the result files belong to you, not to the
container's `k6` user.

| Env var | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:8081` | service under test |
| `IMPL` | derived from the port (`java`/`ts`) | label used in result file names |
| `SCALE` | `1` | multiplies every arrival rate in `load.js` |
| `HOLD` | `3m` | steady-state duration in `load.js` |
| `DURATION` | `30s` | duration of `smoke.js` |
| `RESULTS_DIR` | `perf/results` | where summaries are written |

## Reading the results

k6 prints a short table at the end and writes two files per run to `perf/results/` (git-ignored):

- `<script>-<impl>.md`: requests, error rate, latency percentiles, and each threshold with pass/FAIL.
  CI appends it to the job summary.
- `<script>-<impl>.json`: the full k6 summary (every metric, every sub-metric, every check).

What to look at, in order:

1. **Exit code.** k6 exits non-zero when any threshold fails. That is what fails the CI job.
2. **`http_req_failed`.** Should be well below 1 %. If it is not, look at the checks: `borrow: 201` failing
   usually means the rate limit is on or the books ran out of copies; `replay: Idempotent-Replayed` failing is
   an idempotency bug, not a performance problem.
3. **Per-endpoint p95** (`http_req_duration{name:...}` in `load.js`). Requests are grouped by route with the
   `name` tag (`GET /api/v1/books/:id`), so one slow endpoint is not hidden by many fast ones. Expect
   `GET /books/:id` to be the fastest (Redis cache); the borrow is the slowest (one transaction with row locks,
   an idempotency row and an outbox row).
4. **`dropped_iterations`.** With an arrival-rate executor k6 starts iterations on a schedule. If all
   pre-allocated VUs are busy waiting for slow responses, it drops iterations instead of silently sending less
   traffic. Dropped iterations mean the service could not keep up with the requested rate.
5. **Compare implementations** by running the same script against both ports. Differences under 20-30 % on a
   laptop are noise; look for different shapes (one implementation degrading with `SCALE` while the other
   stays flat) rather than small absolute gaps.

The numbers are only meaningful relative to each other on the same machine. A laptop running Postgres,
Redis, both services and k6 at once is not a capacity test of production.
