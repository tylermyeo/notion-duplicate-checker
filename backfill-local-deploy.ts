/**
 * Local Backfill Script for Notion Duplicate Detection (Client Deployment)
 * 
 * This script runs locally (not on Val.town) to bypass timeout limits.
 * It fetches all pages from Notion, detects duplicates in-memory, and tags them.
 * 
 * Configured for client's Notion database:
 * - Property name: "клиент" (Russian, instead of "Name")
 * - Tag property: "Duplicate Flag" (instead of "Tags")
 * 
 * Usage:
 *   NOTION_TOKEN=your_token NOTION_DATABASE_ID=your_db_id \
 *     deno run --allow-net --allow-env backfill-local-deploy.ts
 * 
 * After this completes, run the index-builder Val on Val.town to populate the SQLite index.
 */

/**
 * Configuration
 * 
 * DRY_RUN: Test mode that logs intended actions without making changes.
 * ALWAYS test with DRY_RUN=true first on production data.
 * 
 * BATCH_SIZE: Notion API maximum (100 pages per request).
 * 
 * RATE_LIMIT_DELAY: Small delay between API calls to stay under Notion's
 * 3 req/sec rate limit. 100ms = ~10 req/sec, but we also have exponential
 * backoff if we hit 429 errors.
 * 
 * WHY run locally: No Val.town timeout constraints. Can process 150k+ records
 * in ~15 minutes without worrying about 1-minute execution limits.
 */
const DRY_RUN = false; // Set to true to test without making changes
const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY = 100; // 100ms between API calls
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface NotionPage {
  id: string;
  properties: {
    клиент?: {
      title: Array<{ plain_text: string }>;
    };
    "Duplicate Flag"?: {
      multi_select: Array<{ name: string }>;
    };
  };
}

interface NotionQueryResponse {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Normalize name for comparison (trim and lowercase)
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Get Notion API headers
 */
function getNotionHeaders(): HeadersInit {
  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) {
    throw new Error("NOTION_TOKEN environment variable is not set");
  }

  return {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000,
): Promise<T> {
  let lastError: any;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      /**
       * Check if it's a retryable error
       * 
       * WHY retry server errors: Notion API occasionally returns 5xx errors
       * during high load. These are transient and usually resolve quickly.
       * Retrying with backoff is better than failing the entire backfill.
       */
      const isRateLimit = error.message?.includes("429") || error.message?.includes("Rate limit");
      const isServerError = error.message?.includes("502") || 
                          error.message?.includes("500") || 
                          error.message?.includes("503") ||
                          error.message?.includes("504") ||
                          error.message?.includes("Internal server error");
      
      if (isRateLimit || isServerError) {
        const delay = initialDelay * Math.pow(2, i);
        const errorType = isRateLimit ? "Rate limit" : "Server error";
        console.log(
          `  ${errorType} hit, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // If it's not a retryable error, throw immediately
      throw error;
    }
  }

  throw lastError;
}

/**
 * Query Notion database with pagination
 */
async function queryNotionDatabase(
  databaseId: string,
  startCursor: string | null,
  pageSize: number,
): Promise<NotionQueryResponse> {
  const body: any = {
    page_size: pageSize,
  };

  if (startCursor) {
    body.start_cursor = startCursor;
  }

  const response = await retryWithBackoff(() =>
    fetch(
      `${NOTION_API_BASE}/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: getNotionHeaders(),
        body: JSON.stringify(body),
      },
    )
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to query Notion database: ${response.status} ${errorText}`,
    );
  }

  return await response.json();
}

/**
 * Fetch a page from Notion API
 */
async function fetchNotionPage(pageId: string): Promise<NotionPage> {
  const response = await retryWithBackoff(() =>
    fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
      method: "GET",
      headers: getNotionHeaders(),
    })
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Notion page ${pageId}: ${response.status} ${errorText}`,
    );
  }

  return await response.json();
}

/**
 * Update Tags property on a Notion page
 */
async function updateNotionTags(
  pageId: string,
  existingTags: Array<{ name: string }>,
): Promise<boolean> {
  // Check if "Duplicate" tag already exists
  const hasDuplicateTag = existingTags.some(
    (tag) => tag.name.toLowerCase() === "duplicate",
  );

  if (hasDuplicateTag) {
    return false; // Already tagged, skip
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would tag page ${pageId} as "Duplicate"`);
    return true;
  }

  // Add "Duplicate" tag to existing tags
  const updatedTags = [
    ...existingTags,
    { name: "Duplicate" },
  ];

  await retryWithBackoff(async () => {
    const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
      method: "PATCH",
      headers: getNotionHeaders(),
      body: JSON.stringify({
        properties: {
          "Duplicate Flag": {
            multi_select: updatedTags,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update Notion page ${pageId}: ${response.status} ${errorText}`,
      );
    }
  });

  console.log(`  Tagged page ${pageId} as "Duplicate"`);
  return true;
}

/**
 * Fetch all pages from Notion database
 */
async function fetchAllPages(databaseId: string): Promise<NotionPage[]> {
  console.log("📥 Fetching all pages from Notion...");
  const allPages: NotionPage[] = [];
  let cursor: string | null = null;
  let batchCount = 0;

  do {
    batchCount++;
    console.log(`  Fetching batch ${batchCount}...`);

    const response = await queryNotionDatabase(databaseId, cursor, BATCH_SIZE);
    allPages.push(...response.results);

    console.log(`  Fetched ${response.results.length} pages (total: ${allPages.length})`);

    cursor = response.next_cursor;

    // Small delay to avoid rate limiting
    if (cursor) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  } while (cursor);

  console.log(`✅ Fetched ${allPages.length} total pages\n`);
  return allPages;
}

/**
 * Build duplicate map from pages
 */
function buildDuplicateMap(
  pages: NotionPage[],
): Map<string, NotionPage[]> {
  console.log("🔍 Building duplicate map...");
  const nameMap = new Map<string, NotionPage[]>();

  for (const page of pages) {
    const name = page.properties["клиент"]?.title?.[0]?.plain_text;
    if (!name) {
      console.log(`  ⚠️  Skipping page ${page.id} - no клиент property`);
      continue;
    }

    const normalizedName = normalizeName(name);
    if (!nameMap.has(normalizedName)) {
      nameMap.set(normalizedName, []);
    }
    nameMap.get(normalizedName)!.push(page);
  }

  // Count duplicates
  let duplicateCount = 0;
  let duplicatePageCount = 0;
  for (const [, pagesWithName] of nameMap) {
    if (pagesWithName.length > 1) {
      duplicateCount++;
      duplicatePageCount += pagesWithName.length;
    }
  }

  console.log(`✅ Found ${duplicateCount} duplicate names affecting ${duplicatePageCount} pages\n`);
  return nameMap;
}

/**
 * Tag all duplicate pages
 */
async function tagDuplicates(
  nameMap: Map<string, NotionPage[]>,
): Promise<{ totalDuplicates: number; tagged: number; skipped: number }> {
  console.log("🏷️  Tagging duplicate pages...");

  let totalDuplicates = 0;
  let tagged = 0;
  let skipped = 0;
  let processed = 0;

  for (const [name, pages] of nameMap) {
    if (pages.length <= 1) {
      continue; // Skip unique names
    }

    totalDuplicates += pages.length;
    console.log(`\n  Processing "${pages[0].properties["клиент"]?.title?.[0]?.plain_text}" (${pages.length} duplicates):`);

    for (const page of pages) {
      try {
        // Fetch latest page data to get current tags
        const currentPage = await fetchNotionPage(page.id);
        const currentTags = currentPage.properties["Duplicate Flag"]?.multi_select || [];

        const wasTagged = await updateNotionTags(page.id, currentTags);
        if (wasTagged) {
          tagged++;
        } else {
          skipped++;
        }

        processed++;

        // Progress update every 50 pages
        if (processed % 50 === 0) {
          console.log(`\n  Progress: ${processed}/${totalDuplicates} pages processed`);
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
      } catch (error: any) {
        console.error(`  ❌ Failed to tag page ${page.id}:`, error.message);
      }
    }
  }

  console.log(`\n✅ Tagging complete!\n`);
  return { totalDuplicates, tagged, skipped };
}

/**
 * Main backfill function
 */
async function main(): Promise<void> {
  const startTime = Date.now();

  console.log("═══════════════════════════════════════════════════");
  console.log("  Notion Duplicate Detection - Local Backfill");
  console.log("  (Client Deployment Version)");
  console.log("═══════════════════════════════════════════════════\n");

  // Validate environment variables
  const databaseId = Deno.env.get("NOTION_DATABASE_ID");
  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID environment variable is not set");
  }

  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) {
    throw new Error("NOTION_TOKEN environment variable is not set");
  }

  console.log(`📋 Configuration:`);
  console.log(`  Database ID: ${databaseId}`);
  console.log(`  Dry run: ${DRY_RUN ? "YES (no changes will be made)" : "NO (will tag pages)"}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Rate limit delay: ${RATE_LIMIT_DELAY}ms\n`);

  try {
    // Step 1: Fetch all pages
    const allPages = await fetchAllPages(databaseId);

    // Step 2: Build duplicate map
    const nameMap = buildDuplicateMap(allPages);

    // Step 3: Tag duplicates
    const { totalDuplicates, tagged, skipped } = await tagDuplicates(nameMap);

    // Final summary
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    console.log("═══════════════════════════════════════════════════");
    console.log("  BACKFILL COMPLETE");
    console.log("═══════════════════════════════════════════════════");
    console.log(`Total pages scanned: ${allPages.length}`);
    console.log(`Duplicate pages found: ${totalDuplicates}`);
    console.log(`Pages tagged: ${tagged}`);
    console.log(`Pages skipped (already tagged): ${skipped}`);
    console.log(`Duration: ${duration} minutes`);
    console.log("═══════════════════════════════════════════════════\n");

    if (DRY_RUN) {
      console.log("⚠️  DRY RUN MODE - No changes were made to Notion");
      console.log("Set DRY_RUN = false to actually tag pages\n");
    } else {
      console.log("✅ All duplicates have been tagged in Notion!");
      console.log("\n📝 Next step: Run the index-builder Val on Val.town");
      console.log("   to populate the SQLite index.\n");
    }
  } catch (error: any) {
    console.error("\n❌ Error during backfill:");
    console.error(error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

// Run main function
if (import.meta.main) {
  main();
}
