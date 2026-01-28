# Incremental Backfill Script - Usage Guide

## Overview

The new `backfill-incremental.py` script replaces `backfill-csv-optimized.py` with a better approach:

- ✅ **Single execution runs until complete** (no manual re-runs needed)
- ✅ **Auto-resume if crashes** (saves progress every batch)
- ✅ **No CSV needed** (fetches directly from Notion API)
- ✅ **No downtime required** (runs while team uses database)
- ✅ **Fixed Select property handling** (was causing the 400 error)

## Quick Start

### 1. Activate Python environment

```bash
source venv/bin/activate
```

### 2. Run the script (DRY RUN first)

```bash
NOTION_TOKEN=your_token NOTION_DATABASE_ID=your_db_id \
  python backfill-incremental.py
```

By default, `DRY_RUN = False` in the script, so it will actually tag pages.

### 3. To test without changes (dry run)

Edit the script and set:
```python
DRY_RUN = True
```

Then run as above.

## How It Works

The script runs in 3 phases:

### Phase 1: Fetch Pages
- Fetches all pages from the database in batches of 100
- Saves progress after each batch to `backfill-progress.json`
- Builds a duplicate map incrementally (with deduplication to prevent false positives)

### Phase 2: Cleanup False Positives
- Queries all currently tagged pages
- Compares with true duplicates from the map
- **Automatically removes tags from non-duplicates** (false positives)
- This fixes any mistakes from previous runs!

### Phase 3: Tag True Duplicates
- Tags all genuine duplicate pages with "Duplicate" flag
- Saves progress after every 10 pages
- Skips pages already tagged

**If the script crashes**, just run it again - it will resume from where it left off!

## Progress Tracking

The script creates `backfill-progress.json` which stores:
- Current phase status
- Last cursor position
- Duplicate map
- List of already-tagged pages

You can delete this file to start fresh.

## Expected Runtime

With ~33,700 pages:
- Fetch phase: ~3-4 hours (with rate limiting)
- Tag phase: Depends on number of duplicates

The script prints progress updates every batch/10 pages.

## Key Differences from Old Script

| Feature | Old (CSV) | New (Incremental) |
|---------|-----------|-------------------|
| Input | CSV export | Direct API |
| Execution | Manual re-runs | Single execution |
| Resume | ❌ No | ✅ Yes |
| Progress tracking | ❌ No | ✅ Yes |
| Downtime required | ✅ Yes | ❌ No |
| Select property | ❌ Broken | ✅ Fixed |

## Troubleshooting

### Script crashes
- **Just run it again!** It will resume from saved progress.

### Want to start over
```bash
rm backfill-progress.json
```

### Check progress
```bash
cat backfill-progress.json
```

## Next Steps After Completion

Once the backfill completes:

1. Run the index-builder Val on Val.town to populate the SQLite index
2. Set up the duplicate-checker Val for live detection
3. Configure Notion automation to trigger the webhook

See `DEPLOYMENT-CHECKLIST.md` for details.
