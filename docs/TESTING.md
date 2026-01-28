# Testing Checklist

Test these scenarios before going live:

## ✅ Basic Functionality
- [x] Add first page with name "Test A" → Should be indexed (no tag)
- [x] Add second page with name "Test A" → Both should get "Duplicate" tag
- [x] Verify tags appear in Notion within 5-10 seconds
- [x] Check Val.town logs show successful tagging

## ✅ Case Sensitivity
- [x] Add page "john doe"
- [x] Add page "John Doe"
- [x] Add page "JOHN DOE"
- [x] All three should be tagged as duplicates

## ✅ Multiple Duplicates (3+)
- [x] Add page "Company ABC"
- [x] Add page "Company ABC" (2nd)
- [x] Add page "Company ABC" (3rd)
- [x] All three should get "Duplicate" tag

## ✅ Whitespace Handling
- [x] Add page " Trimmed " (with spaces)
- [x] Add page "Trimmed" (no spaces)
- [x] Both should be tagged as duplicates

## ✅ Edge Cases
- [x] Add page with empty name → Should gracefully skip (returns 200 to avoid breaking automation)
- [x] Add page with very long name (200+ chars) → Should work
- [x] Add 10 pages rapidly → All should process correctly

## ✅ Error Handling
- [ ] Test with invalid Notion token → Should log error but not crash
- [ ] Test with page that doesn't exist → Should handle gracefully

## ⚠️ Known Limitations
- SQLite index persists in Val.town (survives restarts)
- Existing records need backfill to be indexed
- Rate limit: ~200 new records/day (per your requirement)

---

## 🚀 Local Backfill Testing (RECOMMENDED APPROACH)

This is the new, faster approach that bypasses Val.town's timeout limits.

### Phase 1: Test Local Script with Small Dataset
- [ ] Create test database with 100 records (include ~10 duplicates)
- [ ] Set environment variables:
  ```bash
  export NOTION_TOKEN="your_token"
  export NOTION_DATABASE_ID="your_db_id"
  ```
- [ ] Edit `backfill-local.ts`: Set `DRY_RUN = true`
- [ ] Run: `deno run --allow-net --allow-env backfill-local.ts`
- [ ] Verify output shows duplicate detection
- [ ] Verify logs show "Would tag" messages
- [ ] Verify NO tags actually added to Notion
- [ ] Review timing: should complete in < 1 minute

### Phase 2: Test with Real Tagging
- [ ] Edit `backfill-local.ts`: Set `DRY_RUN = false`
- [ ] Run: `deno run --allow-net --allow-env backfill-local.ts`
- [ ] Verify duplicates are tagged in Notion
- [ ] Verify unique pages are NOT tagged
- [ ] Check for any errors in output
- [ ] Verify all duplicates found (spot-check in Notion)

### Phase 3: Test Index Builder
- [ ] Go to val.town, create new Val called "index-builder-v1"
- [ ] Copy code from `index-builder-v1/main.ts`
- [ ] Set type to "HTTP" (for manual testing)
- [ ] Add environment variables (NOTION_TOKEN, NOTION_DATABASE_ID)
- [ ] Click "Run" in Val.town
- [ ] Verify it processes a batch of 500 pages
- [ ] Check logs show "Indexed X pages"
- [ ] Click "Run" again - should resume from cursor
- [ ] Continue until "Index building complete" message
- [ ] Verify SQLite has all records (check with SQLite Explorer)

### Phase 4: Full 10k Test
- [ ] Import 10k test records to Notion (automation OFF)
- [ ] Clear progress: Delete `index_builder_progress` table
- [ ] Run local backfill: Should complete in ~10-15 minutes
- [ ] Verify all duplicates tagged in Notion
- [ ] Deploy index builder as Scheduled Val (15 min interval)
- [ ] Let it run automatically for 2-3 hours
- [ ] Verify "Index complete" message in logs
- [ ] Test webhook: Add new duplicate, should tag correctly

### Phase 5: Client Database (15k records)
- [ ] Get client's NOTION_TOKEN and NOTION_DATABASE_ID
- [ ] Set environment variables locally
- [ ] Run with `DRY_RUN = true` first
- [ ] Review output with client: "Would tag X duplicates"
- [ ] Get approval to proceed
- [ ] Run with `DRY_RUN = false`
- [ ] Monitor progress: ~10-15 minutes
- [ ] Verify completion in logs
- [ ] Deploy index builder to client's Val.town account
- [ ] Monitor until index building complete
- [ ] Enable Notion automation
- [ ] Test: Add duplicate in Notion, verify tagging works

**Total Time:** 25-45 minutes (vs. 4-6 hours with chunked approach!)

---

## 🔄 Backfill Testing (Chunked Scheduled Val - LEGACY)

### Phase 1: Local Testing with Small Dataset
- [ ] Create test database with 100 records (include ~10 duplicates)
- [ ] Edit `backfill-scheduled.ts`: Set `BATCH_SIZE = 20`
- [ ] Deploy to Val.town as an HTTP Val (test manually first)
- [ ] Run backfill manually 5 times: `vt run username/backfill-scheduled`
- [ ] Verify progress table updates correctly between runs
- [ ] Verify all 100 records indexed after 5 runs
- [ ] Verify duplicates tagged correctly in Notion
- [ ] Verify "completed" flag set to true after final run
- [ ] Check logs show correct counts

### Phase 2: Test with 1000 Records
- [ ] Generate 1000 test records (50 duplicates): `node generate-test-data.js 1000`
- [ ] Import CSV to Notion (with automation OFF)
- [ ] Clear progress: `DELETE FROM backfill_progress;`
- [ ] Edit `backfill-scheduled.ts`: Set `BATCH_SIZE = 200`
- [ ] Convert Val to scheduled (15 min interval) or run manually 5 times
- [ ] Monitor logs for all runs
- [ ] Verify completion message appears
- [ ] Spot-check Notion for tagged duplicates
- [ ] Verify no errors in logs
- [ ] Time one run: Should complete in < 50 seconds

### Phase 3: Resume/Recovery Testing
- [ ] Clear progress table: `DELETE FROM backfill_progress;`
- [ ] Run backfill once - verify it starts from beginning
- [ ] Let it process 2 batches (400 records)
- [ ] Check progress table shows cursor and counts
- [ ] Run again - should resume from cursor, not restart
- [ ] Verify no duplicate tags added (check a few pages)
- [ ] Verify no duplicate index entries (check SQLite)
- [ ] Complete the backfill
- [ ] Run again - should skip (already completed)

### Phase 4: Performance Testing
- [ ] Time one run with BATCH_SIZE=1000
- [ ] Should complete in < 50 seconds (safety margin for 1-min timeout)
- [ ] Check logs for SQLite rate limit retries
- [ ] Check logs for Notion API rate limit warnings
- [ ] Verify memory usage is acceptable
- [ ] Calculate: How long for 15k records? (~4 hours = 15 runs)

### Phase 5: Dry Run Testing
- [ ] Edit `backfill-scheduled.ts`: Set `DRY_RUN = true`
- [ ] Clear progress and run backfill
- [ ] Verify logs show "Would tag" messages
- [ ] Verify NO tags actually added to Notion
- [ ] Verify pages are indexed (even in dry run)
- [ ] Set `DRY_RUN = false` for real runs

### Phase 6: Full 10k Test (Final Rehearsal)
- [ ] Import 10k test records to Notion
- [ ] Clear progress table
- [ ] Set `BATCH_SIZE = 1000`
- [ ] Enable scheduled Val (15 min interval)
- [ ] Let run automatically for 3-4 hours
- [ ] Check logs every hour for progress
- [ ] Verify completion message
- [ ] Verify all duplicates tagged in Notion
- [ ] Verify webhook still works (add new duplicate, should tag)

---

## 📋 Pre-Client Deployment Checklist

### Safety Review
- [ ] Backfill tested end-to-end on 10k records
- [ ] Documented exact time per 1000 records
- [ ] Confirmed < 1 minute per run (free tier compatible)
- [ ] Tested resume after interruption (works correctly)
- [ ] Verified idempotency (safe to re-run)
- [ ] Tested dry run mode (logs without tagging)
- [ ] Prepared rollback plan (can clear progress, disable schedule)
- [ ] Screenshots/documentation of successful test run

### Client Database Preparation
- [ ] Received client's NOTION_TOKEN
- [ ] Received client's NOTION_DATABASE_ID  
- [ ] Signed into client's Val.town account
- [ ] Deployed webhook Val to their account (already working)
- [ ] Deployed backfill scheduled Val to their account
- [ ] Set environment variables in their Val.town
- [ ] Confirmed Notion automation is OFF (critical!)

### Dry Run on Client Database (15k records)
- [ ] Set `DRY_RUN = true` in backfill script
- [ ] Set `BATCH_SIZE = 1000`
- [ ] Set schedule to 15 minutes
- [ ] Enable schedule for 1 hour (4 runs = 4k records sampled)
- [ ] Review logs with client
- [ ] Show: "Would tag X duplicates across Y records"
- [ ] Calculate: Estimated Z duplicates in full 15k database
- [ ] Get client approval to proceed with real run

### Production Backfill Execution
- [ ] Client confirms Notion automation is OFF
- [ ] Client aware this will take ~4 hours
- [ ] Set `DRY_RUN = false`
- [ ] Enable schedule (15 min interval)
- [ ] Monitor first 3 runs closely (first hour)
- [ ] Spot-check Notion for tags appearing correctly
- [ ] Check logs every hour for progress
- [ ] Wait for "BACKFILL COMPLETE!" message (~4 hours)
- [ ] Verify final counts in logs match expectations
- [ ] Disable schedule (no longer needed)
- [ ] Verify progress table shows completed=true

### Enable Real-Time Detection
- [ ] Create Notion automation in client's database
- [ ] Trigger: "When a page is added to database"
- [ ] Action: "Send webhook" to Val.town URL
- [ ] Body: "Include page data"
- [ ] Test with one new duplicate page
- [ ] Verify both pages tagged within 10 seconds
- [ ] Test with one new unique page
- [ ] Verify it doesn't get tagged
- [ ] Monitor logs for 1 hour
- [ ] Check for any errors

### Final Handoff
- [ ] Provide client with Val.town logs access
- [ ] Share documentation (README, HANDOFF, QUICK-REFERENCE)
- [ ] Demonstrate where to check logs
- [ ] Show backfill completion summary
- [ ] Explain how to check progress (if they want to re-run)
- [ ] Walk through troubleshooting scenarios
- [ ] Test: Add duplicate in Notion together
- [ ] Client confirms system is working correctly
- [ ] System fully operational ✅

---

## 🎯 Success Criteria

Before considering deployment complete:

**Webhook (Real-Time Detection):**
- [x] Detects duplicates when new pages added
- [x] Tags both new and existing duplicates
- [x] Case-insensitive matching works
- [x] Handles edge cases gracefully
- [x] Returns 200 to avoid breaking automation

**Backfill (Historical Data):**
- [ ] Processes 15k records in ~4 hours
- [ ] No timeouts or crashes
- [ ] All duplicates tagged correctly
- [ ] Progress tracking works
- [ ] Resume capability verified
- [ ] Can run in dry-run mode
- [ ] Client can monitor via logs

**Integration:**
- [ ] Backfill + webhook work together
- [ ] No conflicts or duplicate tagging
- [ ] SQLite index shared correctly
- [ ] Documentation complete
- [ ] Client trained and confident
