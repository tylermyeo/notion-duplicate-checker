# Beginner-Friendly Val Town Setup Guide

## What is Val Town?

Val Town is a platform where you can write and run JavaScript/TypeScript code in the cloud. We'll create two "Vals" (scripts) that will:
1. **Index Builder** - Builds a searchable index of all your Notion pages
2. **Duplicate Checker** - Automatically tags duplicate pages when new ones are created

---

## Before You Start

You'll need these values (from your checklist):
- **NOTION_TOKEN**: `YOUR_NOTION_INTEGRATION_TOKEN`
- **NOTION_DATABASE_ID**: `YOUR_DATABASE_ID`

**Important**: Your Notion database uses property names `client` (not `Name`) and `Duplicate Flag` (not `Tags`). We'll update the code to match.

---

## Setup: Local Backfill Script (Run First!)

This script runs on your local computer to tag all existing duplicate pages in Notion. **Run this BEFORE setting up the Val Town scripts.**

### Step 1: Install Deno

1. Check if Deno is already installed by opening Terminal and running:
   ```bash
   deno --version
   ```
2. If Deno is not installed, install it:
   - **macOS/Linux**: Run `curl -fsSL https://deno.land/install.sh | sh`
   - **Windows**: Run `irm https://deno.land/install.ps1 | iex`
   - Or visit [deno.land](https://deno.land) for other installation methods
3. Verify installation: `deno --version` should show a version number

### Step 2: Update Property Names in the Script

1. Open `backfill-local.ts` in your project folder
2. Make these changes:

**Find line 24** (in the `NotionPage` interface):
```typescript
Name?: {
```
**Change to:**
```typescript
client?: {
```

**Find line 27**:
```typescript
Tags?: {
```
**Change to:**
```typescript
"Duplicate Flag"?: {
```

**Find line 190** (in the `updateNotionTags` function):
```typescript
Tags: {
```
**Change to:**
```typescript
"Duplicate Flag": {
```

**Find line 249** (in the `buildDuplicateMap` function):
```typescript
const name = page.properties.Name?.title?.[0]?.plain_text;
```
**Change to:**
```typescript
const name = page.properties.client?.title?.[0]?.plain_text;
```

**Find line 251**:
```typescript
console.log(`  ⚠️  Skipping page ${page.id} - no Name property`);
```
**Change to:**
```typescript
console.log(`  ⚠️  Skipping page ${page.id} - no client property`);
```

**Find line 295**:
```typescript
console.log(`\n  Processing "${pages[0].properties.Name?.title?.[0]?.plain_text}" (${pages.length} duplicates):`);
```
**Change to:**
```typescript
console.log(`\n  Processing "${pages[0].properties.client?.title?.[0]?.plain_text}" (${pages.length} duplicates):`);
```

**Find line 301**:
```typescript
const currentTags = currentPage.properties.Tags?.multi_select || [];
```
**Change to:**
```typescript
const currentTags = currentPage.properties["Duplicate Flag"]?.multi_select || [];
```

### Step 3: Set DRY_RUN Mode

1. Find line 15 in `backfill-local.ts`:
   ```typescript
   const DRY_RUN = false; // Set to false to actually tag pages
   ```

2. **For your first test run** (recommended):
   - Set `DRY_RUN = true` to see what would happen without making changes
   - This lets you verify the script works correctly

3. **For the real run**:
   - Set `DRY_RUN = false` to actually tag pages in Notion

### Step 4: Set Environment Variables

Open Terminal and navigate to your project folder, then set the environment variables:

**macOS/Linux:**
```bash
export NOTION_TOKEN="YOUR_NOTION_INTEGRATION_TOKEN"
export NOTION_DATABASE_ID="YOUR_DATABASE_ID"
```

**Windows (PowerShell):**
```powershell
$env:NOTION_TOKEN="YOUR_NOTION_INTEGRATION_TOKEN"
$env:NOTION_DATABASE_ID="YOUR_DATABASE_ID"
```

**Windows (Command Prompt):**
```cmd
set NOTION_TOKEN=YOUR_NOTION_INTEGRATION_TOKEN
set NOTION_DATABASE_ID=YOUR_DATABASE_ID
```

### Step 5: Run the Script

1. Make sure you're in the project folder (where `backfill-local.ts` is located)
2. Run the script:

```bash
deno run --allow-net --allow-env backfill-local.ts
```

3. Watch the output - you'll see:
   - Pages being fetched from Notion
   - Duplicate detection progress
   - Tagging progress (if `DRY_RUN = false`)
   - Final summary with counts

### Step 6: Verify Results

1. **If you ran with `DRY_RUN = true`**:
   - Review the output to see how many duplicates would be tagged
   - If everything looks good, set `DRY_RUN = false` and run again

2. **If you ran with `DRY_RUN = false`**:
   - Check your Notion database
   - Find pages you know have duplicates
   - Verify they now have the "Duplicate" tag in the "Duplicate Flag" property
   - The final summary should show:
     - Total pages scanned
     - Duplicate pages found
     - Pages tagged
     - Pages skipped (already had the tag)

### Step 7: What's Next?

After the local backfill completes successfully:
1. ✅ All existing duplicates are now tagged in Notion
2. 📝 Next: Set up the Index Builder Val in Val Town (see next section)
3. 📝 Then: Set up the Duplicate Checker Val for ongoing detection

---

## Setup: Index Builder Val

### Step 1: Create the Val

1. Go to [val.town](https://val.town) and log into the client's account
2. Click **"New Val"** (top right)
3. Name it: `index-builder-v1`
4. Leave it as an **HTTP Val** (default)

### Step 2: Copy the Code

1. Open `index-builder-v1/main.ts` from your local project
2. Copy all the code
3. Paste it into the Val Town editor

### Step 3: Update Property Names

The code uses `Name`, but your database uses `client`. Make these changes:

**Find line 26** (in the `NotionPage` interface):
```typescript
Name?: {
```
**Change to:**
```typescript
client?: {
```

**Find line 274** (in the `processBatch` function):
```typescript
const name = page.properties.Name?.title?.[0]?.plain_text;
```
**Change to:**
```typescript
const name = page.properties.client?.title?.[0]?.plain_text;
```

**Find line 276**:
```typescript
console.log(`  Skipping page ${page.id} - no Name property`);
```
**Change to:**
```typescript
console.log(`  Skipping page ${page.id} - no client property`);
```

### Step 4: Set Environment Variables

1. In the Val editor, find the **"Environment"** section (usually on the right sidebar or in settings)
2. Click **"Add Variable"** or **"Edit Environment"**
3. Add these two variables:

   **Variable 1:**
   - Name: `NOTION_TOKEN`
   - Value: `YOUR_NOTION_INTEGRATION_TOKEN`

   **Variable 2:**
   - Name: `NOTION_DATABASE_ID`
   - Value: `YOUR_DATABASE_ID`

4. Save the environment variables

### Step 5: Save and Test

1. Click **"Save"** in the Val editor
2. Click **"Run"** to test it
3. Check the logs at the bottom - you should see "Index Builder Run Started" and progress messages
4. If you see errors about missing properties, double-check the property name changes

---

## Setup: Duplicate Checker Val (Webhook)

### Step 1: Create the Val

1. Click **"New Val"** again
2. Name it: `duplicate-checker-v1`
3. Make sure it's an **HTTP Val** (this is important - it needs to receive webhooks)

### Step 2: Copy the Code

1. Open `duplicate-checker-v1/main.ts` from your local project
2. Copy all the code
3. Paste it into the Val Town editor

### Step 3: Update Property Names

Make these changes:

**Find line 25** (in the `NotionPage` interface):
```typescript
Name?: {
```
**Change to:**
```typescript
client?: {
```

**Find line 28**:
```typescript
Tags?: {
```
**Change to:**
```typescript
"Duplicate Flag"?: {
```

**Find line 113** (in the `updateNotionTags` function):
```typescript
Tags: {
```
**Change to:**
```typescript
"Duplicate Flag": {
```

**Find line 247** (in the `handler` function):
```typescript
if (!pageData.properties?.Name?.title?.[0]?.plain_text) {
```
**Change to:**
```typescript
if (!pageData.properties?.client?.title?.[0]?.plain_text) {
```

**Find line 248**:
```typescript
console.warn("Skipping: Missing or invalid 'Name' property for page", pageData.id);
```
**Change to:**
```typescript
console.warn("Skipping: Missing or invalid 'client' property for page", pageData.id);
```

**Find line 260**:
```typescript
const name = pageData.properties.Name.title[0].plain_text;
```
**Change to:**
```typescript
const name = pageData.properties.client.title[0].plain_text;
```

**Find line 278**:
```typescript
const currentTags = currentPage.properties.Tags?.multi_select || [];
```
**Change to:**
```typescript
const currentTags = currentPage.properties["Duplicate Flag"]?.multi_select || [];
```

**Find line 287**:
```typescript
const duplicateTags = duplicatePage.properties.Tags?.multi_select || [];
```
**Change to:**
```typescript
const duplicateTags = duplicatePage.properties["Duplicate Flag"]?.multi_select || [];
```

### Step 4: Set Environment Variables

Same as the Index Builder:
1. Find the **"Environment"** section
2. Add:
   - `NOTION_TOKEN` = `YOUR_NOTION_INTEGRATION_TOKEN`
   - `NOTION_DATABASE_ID` = `YOUR_DATABASE_ID`

### Step 5: Get the Webhook URL

1. Save the Val
2. Look for the **"HTTP Endpoint"** or **"URL"** section (usually shown after saving)
3. Copy the URL - it will look something like: `https://your-username.val.town/v/duplicate-checker-v1`
4. **Save this URL** - you'll need it for the Notion automation

---

## Testing

### Test Index Builder

1. Open the `index-builder-v1` Val
2. Click **"Run"**
3. Watch the logs - you should see batches being processed
4. Keep clicking **"Run"** until you see "🎉 INDEX BUILDING COMPLETE!"
5. The total indexed should match (or be close to) the number of pages in your Notion database

### Test Duplicate Checker

1. The duplicate checker only runs when Notion sends it a webhook
2. After you set up the Notion automation (next step), create a test page in Notion
3. Check the Val's logs to see if it processed the page

---

## Connect Notion to the Duplicate Checker

1. In Notion, go to your database
2. Click the **"..."** menu → **"Automations"** or **"Connections"**
3. Create a new automation:
   - **Trigger**: "When a page is created" (or "When a page is updated")
   - **Action**: "Send webhook"
   - **Webhook URL**: Paste the URL you copied from `duplicate-checker-v1`
   - **Method**: POST
   - **Body**: Include the page data (Notion usually provides this automatically)
4. Save and enable the automation

---

## Quick Reference

**Property Name Changes:**
- `Name` → `client` (in all places)
- `Tags` → `"Duplicate Flag"` (in all places - note the quotes because of the space)

**Environment Variables (both Vals):**
- `NOTION_TOKEN`: `YOUR_NOTION_INTEGRATION_TOKEN`
- `NOTION_DATABASE_ID`: `YOUR_DATABASE_ID`

**Script Execution Order:**
1. **backfill-local.ts** (local): Run first to tag all existing duplicates in Notion
2. **index-builder-v1** (Val Town): Run second to build the SQLite index (click "Run" multiple times until complete)
3. **duplicate-checker-v1** (Val Town): Runs automatically via webhook when pages are created/updated in Notion

---

## Troubleshooting

**Error: "NOTION_TOKEN environment variable is not set"**
- Make sure you've added the environment variables in the Val's settings
- Double-check the variable names are exactly `NOTION_TOKEN` and `NOTION_DATABASE_ID` (case-sensitive)

**Error: "Missing or invalid 'client' property"**
- Verify you've updated all property name references from `Name` to `client`
- Check that your Notion database actually has a property named `client`

**Error: "Failed to update Notion page"**
- Make sure the Notion integration has write access to the database
- Verify the `Duplicate Flag` property exists and is a multi-select type

**Index builder keeps running but never completes**
- This is normal for large databases - keep clicking "Run" until you see the completion message
- Each run processes up to 100 pages, so you may need many runs for large databases

**Local backfill script errors: "deno: command not found"**
- Deno is not installed - follow Step 1 in the Local Backfill section to install it
- After installing, you may need to restart your terminal or add Deno to your PATH

**Local backfill script errors: "NOTION_TOKEN environment variable is not set"**
- Make sure you've exported the environment variables in the same terminal session
- Verify the variable names are exactly `NOTION_TOKEN` and `NOTION_DATABASE_ID` (case-sensitive)
- On macOS/Linux, use `export`; on Windows PowerShell, use `$env:`

**Local backfill script is very slow**
- This is normal - it fetches all pages, then tags duplicates one by one
- For large databases (thousands of pages), this can take 30+ minutes
- The script includes rate limiting delays to avoid hitting Notion's API limits

**Local backfill script shows "Skipping page - no client property"**
- Verify you've updated all property name references from `Name` to `client`
- Check that your Notion database actually has a property named `client`
