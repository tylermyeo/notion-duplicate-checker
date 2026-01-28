# Production Handoff Guide

## ✅ What's Already Set Up

### 1. Val.town Webhook (DEPLOYED)
- **URL:** `https://YOUR_USERNAME-YOUR_VAL_ID.web.val.run`
- **Status:** ✅ Active and working
- **Val Name:** `YOUR_USERNAME/duplicate-checker-v1`
- **Location:** https://www.val.town/v/YOUR_USERNAME/duplicate-checker-v1

### 2. Environment Variables (CONFIGURED)
- ✅ `NOTION_TOKEN` - Set in Val.town
- ✅ `NOTION_DATABASE_ID` - Set in Val.town

### 3. Notion Integration (CONFIGURED)
- ✅ Integration created: "Notion Duplicate Checker"
- ✅ Database shared with integration
- ✅ Automation configured: "Duplicate Checker Trigger"

### 4. SQLite Index (ACTIVE)
- ✅ Table `name_index` created
- ✅ Persistent storage enabled
- ⚠️ Currently only has recent test data

## 🔧 What Needs to Be Done

### Option A: No Backfill (Start Fresh)
If you only care about NEW duplicates going forward:

**Action Required:** None! Just monitor for a few days.

**Pros:**
- No setup needed
- Clean slate
- Fast to start

**Cons:**
- Won't detect duplicates among existing 150k records
- Two existing records with same name won't be flagged

### Option B: Backfill Existing 15k Records (RECOMMENDED)
If you want to detect duplicates in existing data:

This uses a two-phase approach to bypass Val.town's timeout limits:

**Phase 1: Local Backfill (Tags Duplicates)**

Run the `backfill-local.ts` script on your local machine:

```bash
# 1. Set environment variables
export NOTION_TOKEN="YOUR_NOTION_INTEGRATION_TOKEN"
export NOTION_DATABASE_ID="YOUR_DATABASE_ID"

# 2. First, test with DRY_RUN (no changes made)
# Edit backfill-local.ts: Set DRY_RUN = true
deno run --allow-net --allow-env backfill-local.ts

# 3. Once verified, run for real
# Edit backfill-local.ts: Set DRY_RUN = false
deno run --allow-net --allow-env backfill-local.ts
```

**Time Required:** 10-15 minutes for 15k records (no timeout limits!)

This script:
- Fetches all pages from Notion
- Detects duplicates in-memory (fast!)
- Tags all duplicate pages with "Duplicate"
- Shows detailed progress logs

**Phase 2: Index Builder (Populates SQLite)**

After local backfill completes, deploy and run the index builder on Val.town:

```bash
# 1. Go to val.town and create new Val called "index-builder-v1"
# 2. Copy code from index-builder-v1/main.ts
# 3. Set type to "Scheduled" (runs every 15 minutes)
# 4. Or set to "HTTP" and click "Run" multiple times
```

**Time Required:** 15-30 minutes for 15k records (processes in batches)

This script:
- Reads all pages from Notion
- Inserts them into SQLite index
- NO duplicate detection or tagging (read-only = fast!)
- Self-completes when done

**Total Time:** 25-45 minutes for complete backfill

## 📊 Monitoring & Maintenance

### Check Logs
View webhook activity:
```bash
vt tail YOUR_USERNAME/duplicate-checker-v1
```

Or in Val.town UI: Logs tab

### What to Monitor
- **Success rate:** Should be ~100% of webhook calls
- **Response time:** Should be < 1 second per request
- **Errors:** Watch for Notion API rate limits or auth failures

### Expected Volume
- ~200 new records/day
- ~200 webhook calls/day
- Storage: ~10-20 MB for 150k records in SQLite

### Troubleshooting

**Tags not appearing:**
1. Check Val.town logs for errors
2. Verify Notion integration has "Update content" permission
3. Check database is shared with integration

**Webhook not triggering:**
1. Check Notion automation is turned ON
2. Verify webhook URL in automation matches Val.town URL
3. Test manually with curl (see README)

**Duplicate not detected:**
1. Check SQLite index has data: Check logs for "Indexed new name"
2. Verify names match exactly (case-insensitive)
3. If index was reset, may need to re-run backfill

## 🔐 Security

### Secrets Management
- ✅ `NOTION_TOKEN` stored securely in Val.town (not in code)
- ✅ `NOTION_DATABASE_ID` stored securely
- ⚠️ Val is public (code visible, secrets hidden)

To make Val private:
1. Go to Val.town settings
2. Change privacy to "Private" or "Unlisted"

### Access Control
- Notion integration only has access to the shared database
- Webhook URL is public but requires correct payload format
- Rate limiting protects against abuse

## 📝 Documentation

All documentation is in this repo:

- **README.md** - Setup and deployment instructions
- **TESTING.md** - Testing checklist and scenarios
- **HANDOFF.md** - This file (production handoff)
- **DEPLOYMENT.md** - Step-by-step deployment guide

## 🎯 Success Criteria

Before considering this "done":

- [ ] Run through TESTING.md checklist
- [ ] Decide on backfill (Option A or B above)
- [ ] Monitor for 1-2 days to ensure stability
- [ ] Document any custom modifications
- [ ] Train team on how to check logs and troubleshoot

## 🚀 Next Steps (Optional Enhancements)

### Future Improvements
1. **Fuzzy matching** - Detect "Jon Smith" vs "John Smith"
2. **Multi-field matching** - Check email + name
3. **Duplicate resolution UI** - Mark duplicates as "merged" or "ignored"
4. **Analytics dashboard** - Track duplicate trends
5. **Slack notifications** - Alert when duplicates found
6. **Batch processing** - Handle bulk imports

### Performance Optimizations
- Add indexing on `created_at` column
- Implement caching for frequent queries
- Use Notion API batch endpoints for multiple updates

## 📞 Support

**Questions?** Refer to:
- Val.town docs: https://docs.val.town
- Notion API docs: https://developers.notion.com
- This repo's README.md

**Val.town Account:** YOUR_USERNAME
**Database ID:** YOUR_DATABASE_ID
**Webhook URL:** https://YOUR_USERNAME-YOUR_VAL_ID.web.val.run
