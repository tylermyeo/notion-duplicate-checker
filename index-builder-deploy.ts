/**
 * Val.town Index Builder - Populates SQLite from Notion (Client Deployment)
 * 
 * This script runs on Val.town after the local backfill completes.
 * It fetches all pages from Notion and populates the SQLite index.
 * 
 * Configured for client's Notion database:
 * - Property name: "клиент" (Russian, instead of "Name")
 * 
 * NO duplicate detection or tagging - just reads from Notion and writes to SQLite.
 * This makes it fast enough to complete within Val.town's timeout limits.
 * 
 * Can be run as:
 * - Scheduled Val (runs every 15 minutes until complete)
 * - HTTP Val (click "Run" manually multiple times)
 */

import { sqlite } from "https://esm.town/v/std/sqlite";

/**
 * Configuration
 * 
 * BATCH_SIZE: Notion API maximum is 100 pages per request. We request the max
 * to minimize total API calls and complete faster.
 * 
 * MAX_RUNTIME_MS: Val.town free tier has 60-second timeout. We stop at 45s to
 * leave buffer for cleanup operations and avoid hitting the hard limit. The
 * script resumes automatically on next run via cursor-based pagination.
 */
const BATCH_SIZE = 100;
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_RUNTIME_MS = 45_000; // 45 seconds (15s buffer before Val.town's 60s limit)

interface NotionPage {
  id: string;
  properties: {
    клиент?: {
      title: Array<{ plain_text: string }>;
    };
  };
}

interface NotionQueryResponse {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

interface Progress {
  last_cursor: string | null;
  total_indexed: number;
  completed: boolean;
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

      // Check if it's a rate limit error
      if (
        error.message?.includes("429") ||
        error.message?.includes("Rate limit")
      ) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(
          `Rate limit hit, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // If it's not a rate limit error, throw immediately
      throw error;
    }
  }

  throw lastError;
}

/**
 * Initialize database tables
 * 
 * WHY separate progress table: Since this script may run multiple times across
 * 15-minute intervals (if scheduled), we need to track where we left off. The
 * progress table stores the Notion API cursor and completion status.
 * 
 * WHY CHECK (id = 1): Ensures only one progress row exists. This makes it easy
 * to read/update progress without WHERE clauses or risk of multiple rows.
 */
async function initializeTables(): Promise<void> {
  // Create name_index table (identical schema to webhook handler for compatibility)
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS name_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      notion_page_id TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create index for O(1) lookups (essential for real-time performance)
  await sqlite.execute(`
    CREATE INDEX IF NOT EXISTS idx_name ON name_index(name)
  `);

  /**
   * Progress tracking table for resumable execution
   * 
   * Single-row design (CHECK id = 1) ensures atomic progress updates without
   * complex queries. last_cursor enables resuming from exact position in Notion's
   * pagination, preventing duplicate processing across Val runs.
   */
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS index_builder_progress (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_cursor TEXT,
      total_indexed INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_run_at DATETIME,
      completed BOOLEAN DEFAULT FALSE
    )
  `);
}

/**
 * Get current progress from database
 */
async function getProgress(): Promise<Progress> {
  const result = await retryWithBackoff(() =>
    sqlite.execute({
      sql: "SELECT last_cursor, total_indexed, completed FROM index_builder_progress WHERE id = 1",
      args: [],
    })
  );

  if (result.rows.length === 0) {
    // First run, initialize progress
    await retryWithBackoff(() =>
      sqlite.execute({
        sql:
          "INSERT INTO index_builder_progress (id, last_cursor, total_indexed, completed) VALUES (1, NULL, 0, FALSE)",
        args: [],
      })
    );
    return {
      last_cursor: null,
      total_indexed: 0,
      completed: false,
    };
  }

  const row = result.rows[0];
  return {
    last_cursor: row[0] as string | null,
    total_indexed: row[1] as number,
    completed: row[2] as boolean,
  };
}

/**
 * Update progress in database
 */
async function updateProgress(data: {
  last_cursor: string | null;
  total_indexed: number;
  completed: boolean;
}): Promise<void> {
  await retryWithBackoff(() =>
    sqlite.execute({
      sql: `
        UPDATE index_builder_progress 
        SET last_cursor = ?, 
            total_indexed = ?, 
            last_run_at = datetime('now'), 
            completed = ?
        WHERE id = 1
      `,
      args: [
        data.last_cursor,
        data.total_indexed,
        data.completed ? 1 : 0,
      ],
    })
  );
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

  const response = await fetch(
    `${NOTION_API_BASE}/databases/${databaseId}/query`,
    {
      method: "POST",
      headers: getNotionHeaders(),
      body: JSON.stringify(body),
    },
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
 * Insert a page into the index
 */
async function insertIntoIndex(name: string, pageId: string): Promise<boolean> {
  const normalizedName = normalizeName(name);

  return retryWithBackoff(async () => {
    try {
      await sqlite.execute({
        sql: "INSERT INTO name_index (name, notion_page_id) VALUES (?, ?)",
        args: [normalizedName, pageId],
      });
      return true; // Successfully inserted
    } catch (error: any) {
      // If this specific page is already indexed, skip it
      if (error.message?.includes("UNIQUE constraint")) {
        return false; // Already exists, skip
      } else {
        throw error;
      }
    }
  });
}

/**
 * Count existing rows in the name_index table
 */
async function getExistingIndexCount(): Promise<number> {
  const result = await retryWithBackoff(() =>
    sqlite.execute({ sql: "SELECT COUNT(*) FROM name_index", args: [] })
  );
  return Number(result.rows[0][0] || 0);
}

/**
 * Process a batch of pages: index them in SQLite
 */
async function processBatch(pages: NotionPage[]): Promise<number> {
  let indexed = 0;

  for (const page of pages) {
    const name = page.properties["клиент"]?.title?.[0]?.plain_text;
    if (!name) {
      console.log(`  Skipping page ${page.id} - no клиент property`);
      continue;
    }

    const wasInserted = await insertIntoIndex(name, page.id);
    if (wasInserted) {
      indexed++;
    }
  }

  return indexed;
}

/**
 * Main scheduled/HTTP function
 */
export default async function indexBuilder(): Promise<Response> {
  const startTime = Date.now();
  const runId = new Date().toISOString();
  const responseHeaders = { "Cache-Control": "no-store" };
  console.log("=== Index Builder Run Started ===");
  console.log(`Time: ${runId}`);
  console.log(`Batch size (requested): ${BATCH_SIZE} (Notion returns up to 100)`);

  try {
    // 1. Initialize tables
    await initializeTables();

    /**
     * 2. Check progress and sync with pre-existing index rows
     * 
     * WHY: If the webhook handler has already indexed some pages (from real-time
     * detection), we want to account for them in our total. This prevents
     * showing misleading progress (e.g., "0 indexed" when 100 already exist).
     */
    const progress = await getProgress();
    if (!progress.completed && progress.total_indexed === 0) {
      const existingCount = await getExistingIndexCount();
      if (existingCount > 0) {
        await updateProgress({
          last_cursor: progress.last_cursor,
          total_indexed: existingCount,
          completed: progress.completed,
        });
        progress.total_indexed = existingCount;
      }
    }

    // 3. Check if already completed
    if (progress.completed) {
      console.log("✅ Index building already completed!");
      console.log(`Total indexed: ${progress.total_indexed}`);
      return new Response(
        `Index building already completed (run ${runId}). Total indexed: ${progress.total_indexed}`,
        { status: 200, headers: responseHeaders },
      );
    }

    console.log(`Previous progress: ${progress.total_indexed} pages indexed`);
    if (progress.last_cursor) {
      console.log(`Resuming from cursor: ${progress.last_cursor.substring(0, 20)}...`);
    }

    // 4. Get database ID
    const databaseId = Deno.env.get("NOTION_DATABASE_ID");
    if (!databaseId) {
      throw new Error("NOTION_DATABASE_ID environment variable is not set");
    }

    // 5. Loop multiple batches until near timeout or no more pages
    let cursor = progress.last_cursor;
    let totalIndexed = progress.total_indexed;
    let completed = false;
    let loopCount = 0;

    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      loopCount++;
      console.log(`\n[Batch ${loopCount}] Fetching up to ${BATCH_SIZE} pages...`);

      const response = await queryNotionDatabase(databaseId, cursor, BATCH_SIZE);
      const pages = response.results;
      cursor = response.next_cursor;
      completed = !response.has_more;

      console.log(`[Batch ${loopCount}] Fetched ${pages.length} pages`);

      if (pages.length === 0) {
        console.log(`[Batch ${loopCount}] No pages to process, marking as complete`);
        await updateProgress({
          last_cursor: null,
          total_indexed: totalIndexed,
          completed: true,
        });
        console.log("🎉 INDEX BUILDING COMPLETE!");
        return new Response(
          `Index building complete (run ${runId}, empty batch). Total indexed: ${totalIndexed}`,
          { status: 200, headers: responseHeaders },
        );
      }

      console.log(`[Batch ${loopCount}] Indexing...`);
      const indexed = await processBatch(pages);
      totalIndexed += indexed;

      await updateProgress({
        last_cursor: cursor,
        total_indexed: totalIndexed,
        completed,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[Batch ${loopCount}] Processed: ${pages.length} pages`);
      console.log(`[Batch ${loopCount}] Indexed: ${indexed} (${pages.length - indexed} already existed)`);
      console.log(`[Batch ${loopCount}] Total indexed so far: ${totalIndexed}`);
      console.log(`[Batch ${loopCount}] Elapsed: ${duration}s`);

      if (completed) {
        console.log("\n🎉 INDEX BUILDING COMPLETE! All pages indexed.");
        console.log("You can now disable this Val if it's scheduled.");
        return new Response(
          `Index building complete (run ${runId}). Total indexed: ${totalIndexed}`,
          { status: 200, headers: responseHeaders },
        );
      }

      /**
       * Stop before hitting Val.town timeout
       * 
       * WHY 85% threshold: Gives us buffer time to:
       * - Update progress table with current cursor
       * - Return clean HTTP response
       * - Avoid mid-operation timeout (would lose progress)
       * 
       * The next run will resume from saved cursor automatically.
       */
      if (Date.now() - startTime > MAX_RUNTIME_MS * 0.85) {
        console.log("\n⏳ Approaching runtime limit, pausing until next run...");
        console.log(`   Processed ${loopCount} batches in this run`);
        console.log(`   Resume by clicking "Run" again (or wait for next scheduled run)`);
        break;
      }
    }

    return new Response(
      `Index builder partial (run ${runId}). Total indexed so far: ${totalIndexed}`,
      { status: 200, headers: responseHeaders },
    );
  } catch (error: any) {
    console.error("\n❌ Error during index building:");
    console.error(error.message);
    console.error(error.stack);

    // Always return a Response for Val.town HTTP Vals
    return new Response(`Error during index building: ${error.message}`, {
      status: 200, // return 200 to avoid Notion/automation disabling on error
      headers: responseHeaders,
    });
  }
}
