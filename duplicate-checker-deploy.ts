/**
 * Val.town Duplicate Checker - Webhook Handler (Client Deployment)
 * 
 * This script runs on Val.town as an HTTP webhook endpoint.
 * It receives notifications from Notion when pages are created/updated,
 * checks for duplicates in the SQLite index, and tags duplicate pages.
 * 
 * Configured for client's Notion database:
 * - Property name: "клиент" (Russian, instead of "Name")
 * - Tag property: "Duplicate Flag" (instead of "Tags")
 */

import { sqlite } from "https://esm.town/v/std/sqlite";

/**
 * Initialize SQLite database with persistent storage
 * 
 * WHY: Val.town provides persistent SQLite storage across function invocations,
 * allowing us to maintain a searchable index of all names for duplicate detection.
 * 
 * COLLATE NOCASE: Enables case-insensitive comparisons at the database level,
 * so "John Smith", "john smith", and "JOHN SMITH" are treated as identical.
 * 
 * UNIQUE constraint on notion_page_id: Ensures idempotent operations - if we
 * receive the same webhook twice, we won't create duplicate index entries.
 */
await sqlite.execute(`
  CREATE TABLE IF NOT EXISTS name_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE,
    notion_page_id TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Create B-tree index for O(1) average-case lookups
 * 
 * WHY: Without this index, queries would be O(n) table scans. With 150k+ records,
 * this would make real-time detection too slow (several seconds per lookup).
 * The index enables sub-millisecond lookups at the cost of slightly slower inserts.
 */
await sqlite.execute(`
  CREATE INDEX IF NOT EXISTS idx_name ON name_index(name)
`);

// Notion API configuration
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface NotionPage {
  id: string;
  properties: {
    клиент?: {
      title: Array<{ plain_text: string }>;
    };
    "Duplicate Flag"?: {
      select: { name: string } | null;
    };
  };
}

interface WebhookBody {
  id: string;
  properties: {
    клиент?: {
      title: Array<{ plain_text: string }>;
    };
  };
}

/**
 * Normalize name for consistent comparison
 * 
 * WHY: Users may enter names with extra whitespace or inconsistent casing.
 * Normalization ensures "John Smith", " john smith ", and "JOHN SMITH" all
 * match as duplicates. We chose simple normalization over fuzzy matching
 * (Levenshtein distance) for speed and to minimize false positives.
 * 
 * @param name - Raw name from Notion
 * @returns Trimmed, lowercase name for matching
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
 * Fetch a page from Notion API
 */
async function fetchNotionPage(pageId: string): Promise<NotionPage> {
  const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: "GET",
    headers: getNotionHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Notion page ${pageId}: ${response.status} ${errorText}`
    );
  }

  return await response.json();
}

/**
 * Update Duplicate Flag property on a Notion page (SELECT type, not multi-select)
 * 
 * WHY idempotent check: If the tag is already present, we skip the update.
 * This avoids unnecessary API calls and makes the operation safe to re-run.
 * Important for error recovery and webhook retries.
 * 
 * @param pageId - Notion page ID to update
 * @param existingTag - Current tag value (null if not set)
 */
async function updateNotionTags(
  pageId: string,
  existingTag: { name: string } | null
): Promise<void> {
  // Idempotent check: Skip if already tagged
  const hasDuplicateTag = existingTag?.name?.toLowerCase() === "duplicate";

  if (hasDuplicateTag) {
    console.log(`Page ${pageId} already has "Duplicate" tag, skipping update`);
    return;
  }

  // Set to "Duplicate" (SELECT type uses single object, not array)
  const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: "PATCH",
    headers: getNotionHeaders(),
    body: JSON.stringify({
      properties: {
        "Duplicate Flag": {
          select: { name: "Duplicate" },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to update Notion page ${pageId}: ${response.status} ${errorText}`
    );
  }

  console.log(`Successfully tagged page ${pageId} as "Duplicate"`);
}

/**
 * Retry a function with exponential backoff for rate limit errors
 * 
 * WHY: Notion API has a rate limit of 3 requests/second. When processing
 * multiple duplicates, we may hit this limit. Exponential backoff (1s, 2s, 4s)
 * gives the API time to recover while ensuring we eventually succeed.
 * 
 * WHY only retry 429: Other errors (auth, network, etc.) likely won't be fixed
 * by retrying, so we fail fast to avoid wasting time and resources.
 * 
 * @param fn - Async function to execute with retry logic
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param initialDelay - Initial delay in ms (default: 1000)
 * @returns Result of successful function execution
 * @throws Last error if all retries exhausted
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Only retry on rate limit errors (HTTP 429)
      if (error.message?.includes("429") || error.message?.includes("Rate limit")) {
        const delay = initialDelay * Math.pow(2, i); // Exponential backoff: 1s, 2s, 4s
        console.log(`Rate limit hit, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-rate-limit errors: fail fast (auth errors, network issues, etc.)
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Find all duplicate pages for a given name
 */
async function findDuplicatePages(normalizedName: string): Promise<string[]> {
  const result = await retryWithBackoff(() => 
    sqlite.execute({
      sql: "SELECT notion_page_id FROM name_index WHERE name = ?",
      args: [normalizedName]
    })
  );

  // Val.town SQLite returns rows as arrays, not objects
  return result.rows.map((row: any) => row[0] as string);
}

/**
 * Insert a new name into the index
 * Multiple pages can have the same name (duplicates are accumulated, not replaced)
 */
async function insertNameIndex(name: string, pageId: string): Promise<void> {
  const normalizedName = normalizeName(name);
  
  try {
    await retryWithBackoff(() =>
      sqlite.execute({
        sql: "INSERT INTO name_index (name, notion_page_id) VALUES (?, ?)",
        args: [normalizedName, pageId]
      })
    );
    console.log(`Indexed new name: "${name}" (page: ${pageId})`);
  } catch (error: any) {
    // If this specific page is already indexed, skip it
    if (error.message?.includes("UNIQUE constraint")) {
      console.log(`Page ${pageId} already indexed, skipping`);
    } else {
      throw error;
    }
  }
}

/**
 * Main HTTP handler for webhook
 */
export default async function handler(req: Request): Promise<Response> {
  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse webhook body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      console.warn("Skipping: Invalid JSON in request body");
      return new Response(
        JSON.stringify({ 
          success: false, 
          skipped: true,
          reason: "Invalid JSON in request body" 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle Notion automation webhook format (wrapped in data object)
    const pageData = body.data || body;

    /**
     * Validate required fields
     * 
     * CRITICAL: We return 200 (not 400) even on validation errors to prevent
     * Notion from disabling the automation. If we return 4xx/5xx, Notion will
     * eventually turn off the webhook after repeated failures. By returning 200
     * with success: false, we acknowledge receipt while logging the issue.
     */
    if (!pageData.id) {
      console.warn("Skipping: Missing 'id' field in webhook body");
      return new Response(
        JSON.stringify({ 
          success: false, 
          skipped: true,
          reason: "Missing 'id' field in webhook body" 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!pageData.properties?.["клиент"]?.title?.[0]?.plain_text) {
      console.warn("Skipping: Missing or invalid 'клиент' property for page", pageData.id);
      return new Response(
        JSON.stringify({ 
          success: false, 
          skipped: true,
          reason: "Missing or invalid 'клиент' property" 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const pageId = pageData.id;
    const name = pageData.properties["клиент"].title[0].plain_text;
    const normalizedName = normalizeName(name);

    console.log(`Processing new page: ${pageId} with name: "${name}"`);

    // Check for duplicates
    const duplicatePageIds = await findDuplicatePages(normalizedName);
    
    /**
     * Filter out the current page from duplicate list
     * 
     * WHY: If the webhook is triggered multiple times for the same page
     * (Notion sometimes sends duplicate webhooks), the page might already
     * be in the index. We don't want to tag it as its own duplicate.
     */
    const otherDuplicates = duplicatePageIds.filter(id => id !== pageId);

    if (otherDuplicates.length > 0) {
      console.log(
        `Found ${otherDuplicates.length} duplicate(s) for name: "${name}"`
      );

      // Fetch current page to get existing tag (SELECT type, not multi_select)
      const currentPage = await fetchNotionPage(pageId);
      const currentTag = currentPage.properties["Duplicate Flag"]?.select || null;

      // Tag the new page
      await updateNotionTags(pageId, currentTag);

      /**
       * Tag all existing duplicate pages
       * 
       * WHY try-catch per page: If one page fails to update (deleted, permissions
       * changed, etc.), we still want to tag the others. This ensures partial
       * success rather than all-or-nothing failure.
       */
      for (const duplicatePageId of otherDuplicates) {
        try {
          const duplicatePage = await fetchNotionPage(duplicatePageId);
          const duplicateTag = duplicatePage.properties["Duplicate Flag"]?.select || null;
          await updateNotionTags(duplicatePageId, duplicateTag);
        } catch (error) {
          console.error(
            `Failed to tag duplicate page ${duplicatePageId}:`,
            error
          );
          // Continue with other duplicates even if one fails
        }
      }

      // Still insert the new page into index (for future duplicate detection)
      await insertNameIndex(name, pageId);

      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          duplicateCount: otherDuplicates.length,
          message: `Tagged ${otherDuplicates.length + 1} pages as duplicates`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      // No duplicate found, insert into index
      await insertNameIndex(name, pageId);

      return new Response(
        JSON.stringify({
          success: true,
          duplicate: false,
          message: "New unique name indexed",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    /**
     * CRITICAL: Return 200 even on unhandled errors
     * 
     * WHY: Returning 5xx errors would cause Notion to disable the automation
     * after repeated failures. By returning 200 with success: false, we:
     * 1. Keep the automation running for future webhooks
     * 2. Log the error for debugging
     * 3. Provide error details in the response for manual inspection
     * 
     * This is a deliberate trade-off: graceful degradation over strict error handling.
     */
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        message: error.message,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
