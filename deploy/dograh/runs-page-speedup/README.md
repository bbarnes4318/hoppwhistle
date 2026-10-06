# Dograh results pages: from minutes (or a timeout) to about a second

Voice Agents in the portal is the Dograh app in a frame. Its results lists — an
agent's **runs** page, a **campaign's** call table, and **Agent Runs** — took
minutes to load and usually failed. Two causes, both in Dograh itself:

1. **Every list loaded each call's full log.** The query behind a page of 50
   calls is `select(WorkflowRunModel)`, which reads every column, including
   `workflow_runs.logs` (the call's whole event log and transcript, often
   hundreds of KB) and `annotations`. Nothing on the list shows them. The campaign
   and Agent Runs lists also joined the agent's entire graph JSON
   (`workflow_definition` / `workflow_json`) once **per row** to print its name
   and version number. One page was tens of MB read out of Postgres and
   json-parsed in Python before being thrown away.
2. **No index for "newest 50 calls of X".** `workflow_runs` only has single-column
   indexes on `workflow_id` and `campaign_id`, so each page load read every call
   the agent or campaign ever made and sorted them all, and the "N calls total"
   count under the list read every row again.

Measured against Dograh's own query code on 406k calls (6k with 100 KB logs):

| list               | before | after  |
| ------------------ | ------ | ------ |
| agent runs         | 829 ms | 47 ms  |
| campaign runs      | 492 ms | 19 ms  |
| Agent Runs (usage) | 543 ms | 150 ms |

Those numbers are for an idle local Postgres. On the box during dialing, with
real log sizes, the "before" side is what was hitting the timeout. Each list
returns exactly the same response as before; the patch only stops fetching
columns the list never used.

## Run it (on the server, as root)

```bash
cd /opt/hopwhistle && git pull
./fix-dograh-runs-page.sh
```

- **Step 1, indexes:** built `CONCURRENTLY`. Calls keep being written, nothing
  is locked and nothing restarts. The lists get faster as soon as it finishes.
- **Step 2, lean queries:** copies the three files out of `dograh-api-1`, patches
  them in `/opt/dograh-patches/runs-page-speedup/`, bind-mounts them in
  `/opt/dograh/docker-compose.override.yaml`, then **asks** before restarting
  the API. A restart drops AI calls in progress (the script shows how many are
  live), so do it between campaigns. If the API doesn't come back healthy with
  the patch loaded, the override is put back and the API restarted as it was.

Options: `--indexes-only` (step 1 only), `--no-restart` (stage step 2 so it goes
live on the next restart), `--restart` (don't ask).

The patcher fails closed. If a file doesn't contain the exact code it expects
(a different Dograh release), that file is left alone and reported. The other
files and the indexes still apply.

## Files

| File                                 | Role                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix_runs_page.py`                   | The one command (`../../../fix-dograh-runs-page.sh` runs it).                                                                                                                    |
| `runs_page_indexes.py`               | Runs inside `dograh-api-1`. Reports table size and builds the three `hw_idx_workflow_runs_*` indexes.                                                                            |
| `runs_page_patch.py`                 | Patches staged copies of `api/db/workflow_run_client.py`, `campaign_client.py` and `organization_usage_client.py`. Dry run by default. Marker `HOPWHISTLE_RUNS_PAGE_SPEEDUP_V1`. |
| `../tests/test_runs_page_speedup.py` | `python deploy/dograh/tests/test_runs_page_speedup.py`                                                                                                                           |

## After upgrading Dograh

The mounted files are copies of the release that was running. After a Dograh
upgrade, delete the three `runs-page-speedup` lines from the override and re-run
`./fix-dograh-runs-page.sh`, so it patches the new release's files. Otherwise the
old copies stay mounted over the new ones. The indexes carry over and need nothing.

## Rollback

```bash
cd /opt/dograh
cp docker-compose.override.yaml.bak-runs-page.<timestamp> docker-compose.override.yaml
docker compose up -d --no-deps api
```

The indexes are harmless to leave in place. To drop them anyway:
`DROP INDEX CONCURRENTLY hw_idx_workflow_runs_workflow_created;` (and
`..._campaign_created`, `..._created_id`) in Dograh's Postgres.
