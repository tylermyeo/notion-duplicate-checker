## Client Deployment Checklist (Notion Duplicate Detector)

Use this to track the full rollout. Each item has notes so you can confirm completion. Check items as you go.

- [x] **Confirm target database and properties**
  - Identify the exact Notion database URL
  - Verify `Name` is the title property used for matching
  - Verify `Tags` is multi-select and has/permits a `Duplicate` option (case-insensitive)

- [x] **Prepare Notion integration**
  - Create or reuse the Notion internal integration in the workspace
  - Copy the integration token → `NOTION_TOKEN`
  - Share the target database with the integration (read/write)
  - Copy the 32-char database ID from the database URL → `NOTION_DATABASE_ID`

- [ ] **Set Val Town environment variables (per Val)**
  - Open each Val: `backfill-v1`, `index-builder-v1`, `duplicate-checker-v1`.
  - Set `NOTION_TOKEN` and `NOTION_DATABASE_ID` in the Val’s environment.

- [ ] **Local backfill + tagging (one-time)**
  - On your machine: ensure Deno is installed (`deno --version`).
  - Export env vars locally:
    - `NOTION_TOKEN`
    - `NOTION_DATABASE_ID`
  - In `backfill-local.ts`, set `DRY_RUN`:
    - Optional rehearsal: `DRY_RUN = true` (logs only).
    - Real run: `DRY_RUN = false` (actually tags).
  - Run: `deno run --allow-net --allow-env backfill-local.ts`
  - Confirm completion in logs: totals for scanned, duplicates found, tagged, skipped.
  - Spot-check in Notion: known duplicate names should now have the `Duplicate` tag on all pages.

- [ ] **Build index in Val Town (`index-builder-v1`)**
  - Run the Val (HTTP: click Run multiple times; Scheduled: let it cycle).
  - Confirm logs show “Index building complete” with expected total indexed.
  - Re-run once to see “already completed” (idempotent check).

- [ ] **Enable live duplicate checker (`duplicate-checker-v1`)**
  - Ensure env vars are set.
  - Copy the Val’s HTTP endpoint URL.
  - In Notion, create/confirm automation to send webhook on page create (and/or update) in the target DB to the Val URL.

- [ ] **Smoke test the live flow**
  - Create a new page with a unique name → should index, no `Duplicate` tag.
  - Create another page with the same name → both pages should get the `Duplicate` tag.
  - Verify logs in Val Town reflect the duplicate detection/tagging.

- [ ] **Communicate status to client**
  - Before start: notify you’re beginning the 4-hour quiet window.
  - After backfill + index: share counts (scanned, duplicates found/tagged, indexed).
  - After webhook test: confirm live tagging is active and tested.

- [ ] **Post-deployment**
  - Keep `duplicate-checker-v1` active for ongoing events.
  - Optionally leave `backfill-v1` as a backup tool (not required if local backfill + index builder succeeded).
