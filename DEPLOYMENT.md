# Deployment Guide

Complete step-by-step guide to deploy the Notion Duplicate Detection System.

## Prerequisites

Before starting, ensure you have:

- ✅ **Val.town account** (free tier works) - [Sign up here](https://val.town)
- ✅ **Notion workspace** with admin access
- ✅ **Deno installed** (for local backfill) - [Install Deno](https://deno.land/manual/getting_started/installation)
- ✅ **Git** (optional, for version control)

## Deployment Steps

### Step 1: Create Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Fill in details:
   - **Name:** "Duplicate Checker" (or your preferred name)
   - **Type:** Internal integration
   - **Associated workspace:** Select your workspace
4. Grant permissions:
   - ✅ **Read content**
   - ✅ **Update content**
   - ✅ **Read user information** (optional)
5. Click **"Submit"**
6. **Copy the Integration Token** (starts with `secret_...`)
   - ⚠️ Save this securely - you'll need it for environment variables

### Step 2: Share Database with Integration

1. Open your Notion database
2. Click the **"..."** menu (top right corner)
3. Select **"Connections"** → **"Add connections"**
4. Find and select your integration ("Duplicate Checker")
5. Click **"Confirm"**

### Step 3: Get Database ID

1. Open your Notion database in a web browser
2. Copy the URL - it looks like:
   ```
   https://www.notion.so/workspace/DATABASE_ID?v=VIEW_ID
   ```
3. Extract the `DATABASE_ID` (32-character hex string between workspace name and `?v=`)
   - Example: `b8add5f616c448bfb00a1844b9cc38dd`

### Step 4: Install Val.town CLI

```bash
# Install Deno (if not already installed)
curl -fsSL https://deno.land/install.sh | sh

# Add Deno to PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="$HOME/.deno/bin:$PATH"

# Install Val.town CLI
deno install -grAf jsr:@valtown/vt

# Verify installation
vt --version
```

### Step 5: Authenticate Val.town CLI

```bash
# Run any vt command to trigger authentication
vt --version
```

Follow the prompts to open your browser and complete OAuth authentication.

### Step 6: Deploy Webhook Handler

```bash
# Clone or download this repository
cd notion-duplicate-checker

# Deploy the webhook handler
vt push duplicate-checker-deploy.ts
```

After deployment, Val.town will provide a webhook URL:
```
https://YOUR_USERNAME-RANDOM_ID.web.val.run
```

**Save this URL** - you'll need it for the Notion automation.

### Step 7: Set Environment Variables

```bash
# Set Notion token
vt secret set NOTION_TOKEN your_integration_token_here

# Set Database ID
vt secret set NOTION_DATABASE_ID your_database_id_here
```

Replace:
- `your_integration_token_here` with the token from Step 1
- `your_database_id_here` with the ID from Step 3

### Step 8: Configure Property Names (If Needed)

The default configuration expects:
- **Name field:** "Name" (title property)
- **Tag field:** "Tags" (multi-select property with "Duplicate" option)

If your database uses different property names:

1. Open `duplicate-checker-deploy.ts`
2. Update the interface and property references:
   ```typescript
   // Change from:
   "Name"?: { title: Array<{ plain_text: string }> }
   "Tags"?: { multi_select: Array<{ name: string }> }
   
   // To your property names:
   "клиент"?: { title: Array<{ plain_text: string }> }
   "Duplicate Flag"?: { select: { name: string } | null }
   ```
3. Re-deploy: `vt push duplicate-checker-deploy.ts`

### Step 9: Set Up Notion Automation

1. Open your Notion database
2. Click **"Automations"** (top right, lightning icon)
3. Click **"+ New automation"**
4. Configure trigger:
   - **When:** "a page is added to database"
   - **Which database:** Select your database
5. Configure action:
   - **Do this:** "Send webhook"
   - **Webhook URL:** Paste URL from Step 6
   - **Method:** POST
   - **Content-Type:** application/json
   - **Body:** Select "Include page data" or use custom:
     ```json
     {
       "id": "{{page.id}}",
       "properties": {
         "Name": {{page.properties.Name}}
       }
     }
     ```
6. Click **"Turn on"**

### Step 10: Test Real-Time Detection

Test the webhook to ensure it's working:

#### Option A: Create Test Page in Notion

1. Add a new page with name "Test Person"
2. Check Val.town logs: `vt tail YOUR_USERNAME/duplicate-checker-deploy`
3. Should see: "New unique name indexed"
4. Add another page "Test Person"
5. Both pages should get "Duplicate" tag within 5-10 seconds

#### Option B: Test with cURL

```bash
curl -X POST https://YOUR_USERNAME-RANDOM_ID.web.val.run \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": "test-page-123",
      "properties": {
        "Name": {
          "title": [{"plain_text": "Test Name"}]
        }
      }
    }
  }'
```

Expected response:
```json
{
  "success": true,
  "duplicate": false,
  "message": "New unique name indexed"
}
```

### Step 11: Backfill Existing Records (Optional)

If you have existing records that need duplicate detection:

#### Phase 1: Tag Duplicates (Local)

```bash
# Set environment variables
export NOTION_TOKEN="your_integration_token"
export NOTION_DATABASE_ID="your_database_id"

# Run the backfill script
deno run --allow-net --allow-env backfill-local-deploy.ts
```

**Time:** ~10-15 minutes for 15k records

**What it does:**
- Fetches all pages from Notion
- Detects duplicates in-memory
- Tags all duplicate pages with "Duplicate"
- Shows progress in console

#### Phase 2: Build Index (Val.town)

```bash
# Deploy index builder
vt push index-builder-deploy.ts

# Run manually (or set to scheduled)
vt run YOUR_USERNAME/index-builder-deploy
```

**Time:** ~15-30 minutes for 15k records (auto-runs in batches)

**What it does:**
- Reads all pages from Notion
- Inserts them into SQLite index
- Saves progress automatically
- Self-completes when done

**Total backfill time:** 25-45 minutes

## Verification

After deployment, verify everything is working:

### Check Webhook Status

```bash
# View recent logs
vt tail YOUR_USERNAME/duplicate-checker-deploy

# Check webhook is running
vt list | grep duplicate
```

### Test Duplicate Detection

1. Create page "Verification Test A"
   - Should NOT be tagged
2. Create page "Verification Test A" (exact same name)
   - Both pages should get "Duplicate" tag
3. Create page "verification test a" (different case)
   - All three should get "Duplicate" tag (case-insensitive)

### Check SQLite Index

1. Go to Val.town dashboard
2. Open your webhook Val
3. Click "SQLite" tab
4. Run query:
   ```sql
   SELECT COUNT(*) FROM name_index;
   ```
5. Should show number of indexed pages

## Troubleshooting

### Webhook Not Triggering

**Symptoms:** New pages don't get tagged

**Solutions:**
1. Check automation is turned ON in Notion
2. Verify webhook URL matches Val.town URL
3. Check Val.town logs for errors: `vt tail YOUR_USERNAME/duplicate-checker-deploy`
4. Test manually with cURL (see Step 10)

### Tags Not Appearing

**Symptoms:** Webhook runs but tags don't appear

**Solutions:**
1. Verify Notion integration has "Update content" permission
2. Check database is shared with integration
3. Ensure "Duplicate" option exists in Tags property (multi-select)
4. Check Val.town logs for API errors

### Duplicates Not Detected

**Symptoms:** Duplicate pages don't get tagged

**Solutions:**
1. Check SQLite index has data: `SELECT * FROM name_index LIMIT 10;`
2. Verify names match exactly (case-insensitive, but exact text)
3. Check whitespace (names are trimmed automatically)
4. Run backfill to populate index

### Rate Limit Errors

**Symptoms:** Errors mentioning "429" or "Rate limit"

**Solutions:**
- System already has exponential backoff retry
- Check logs to see if retries are succeeding
- If persistent, reduce batch size in backfill scripts

### Environment Variables Not Set

**Symptoms:** "NOTION_TOKEN environment variable is not set"

**Solutions:**
```bash
# Check if secrets are set
vt secret list

# Re-set if needed
vt secret set NOTION_TOKEN your_token
vt secret set NOTION_DATABASE_ID your_database_id
```

## Monitoring

### What to Monitor

**Weekly:**
- Total webhook calls (should match new pages added)
- Error rate (should be < 1%)
- Response time (should be < 1 second)

**Monthly:**
- SQLite database size (should grow slowly)
- Duplicate detection accuracy (spot-check)

### View Logs

```bash
# Tail logs in real-time
vt tail YOUR_USERNAME/duplicate-checker-deploy

# View specific Val's logs
# Go to https://val.town/v/YOUR_USERNAME/duplicate-checker-deploy
# Click "Logs" tab
```

## Maintenance

### Zero Maintenance Required

Once deployed, the system runs automatically:
- ✅ Webhook responds to new pages
- ✅ SQLite persists across Val.town restarts
- ✅ Errors are logged but don't break automation
- ✅ Rate limiting handled automatically

### Optional: Periodic Checks

- Check logs once a month for any errors
- Verify duplicate detection is still working
- Monitor SQLite database size

### Updates

To update the webhook code:

```bash
# Edit files locally
nano duplicate-checker-deploy.ts

# Push changes
vt push duplicate-checker-deploy.ts
```

Changes take effect immediately (no restart needed).

## Uninstall

To remove the system:

1. **Turn off Notion automation**
   - Go to database → Automations → Turn off webhook automation
2. **Delete Vals**
   ```bash
   vt delete duplicate-checker-deploy
   vt delete index-builder-deploy
   ```
3. **Remove integration**
   - Go to https://www.notion.so/my-integrations
   - Delete "Duplicate Checker" integration
4. **Clean up tags (optional)**
   - Manually remove "Duplicate" tags from pages if desired

## Support

### Documentation

- **[README.md](README.md)** - Project overview
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical deep-dive
- **[docs/TESTING.md](docs/TESTING.md)** - Testing checklist

### Common Issues

See the [docs/HANDOFF.md](docs/HANDOFF.md) for additional troubleshooting and maintenance tips.

### External Resources

- **Val.town Docs:** https://docs.val.town
- **Notion API Docs:** https://developers.notion.com
- **Deno Docs:** https://deno.land/manual

## Next Steps

After successful deployment:

1. ✅ Monitor for 1-2 days to ensure stability
2. ✅ Train team on checking logs and troubleshooting
3. ✅ Document any custom modifications
4. ✅ Consider optional enhancements (fuzzy matching, analytics, etc.)

---

**Congratulations!** Your duplicate detection system is now live. 🎉
