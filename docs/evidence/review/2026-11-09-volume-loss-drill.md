# SC-02 companion: database volume-loss restore drill

**Date:** 2026-11-09
**Classification:** valid local restore drill; the real volume was never modified

## Method

`scripts/sc02-restore-drill.sh` dumps the live database (`public` schema,
`pg_dump -Fc`), waits while a validated smoke load creates acknowledged sales,
then restores the dump into a throwaway container from the same image
(`public.ecr.aws/supabase/postgres:17.6.1.155`) and compares row counts and
timestamps. Simulated loss means "recover only from the backup"; nothing was
deleted.

## Results

| Run | Rows at backup | Rows at simulated loss | Rows after restore | Acknowledged rows lost | Restore time |
|---|---:|---:|---:|---:|---:|
| `rpo1` (baseline, no sales after backup) | 42,943 | 42,943 | 42,943 | 0 | 14 s |
| `rpo2` | 42,943 | 43,093 | 42,943 | **150** | 12 s |

In `rpo2` the backup was taken at 10:12:36Z and the simulated loss was recorded
at 10:15:43Z: **187 s of exposure**. The 150 lost rows are exactly the 150
sales of `rpo2load`, which reconciled 150 of 150 before the comparison.

`rpo1` is kept as a baseline: it proves the restore works, not what is lost.
In `rpo2/result.json`, `rpo_window_s` (7,080 s) is the gap between the newest
sale in each database and includes idle time before the backup. It is not the
RPO. The exposure above is computed from `events.log`. The script now reports
`exposure_since_backup_s` instead.

## Findings

- **No automated backup exists.** Volume-loss RPO is the time since the last
  manual dump. This drill shows one example, not a guarantee.
- **A `public`-only backup is not a recovery.** `pg_restore` reported 6 errors:
  one "schema public already exists" and five foreign keys to `auth.users`
  (`branch_assignments`, `pos_sale_requests`, `profiles`, `sales`,
  `user_roles`) that could not be recreated because the identities were not in
  the backup. Sale data restored; users and those constraints did not.

## Limits

One host, one image, a scratch container rather than a disaster-recovery site.
The `auth` schema and storage were not backed up or restored; a full-database
backup and a login test after restore are not yet evidenced. Continuous
archiving (point-in-time recovery) is designed here, not built. Restore time
applies to this ~10 MB dump only.