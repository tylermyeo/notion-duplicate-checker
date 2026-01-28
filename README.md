# Notion Duplicate Detection System

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Deno](https://img.shields.io/badge/Deno-000000?style=flat&logo=deno&logoColor=white)](https://deno.land/)
[![Val.town](https://img.shields.io/badge/Val.town-Serverless-blue)](https://val.town)
[![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-ready serverless duplicate detection system for Notion databases, deployed on Val.town. Automatically identifies and tags duplicate records in real-time as they're created, with support for backfilling 150k+ existing records.

## 🎯 The Problem

A CRM database with 150,000+ records was experiencing data quality issues due to duplicate client entries. The team needed:
- **Real-time detection** for ~200 new records added daily
- **Historical backfill** to tag existing duplicates
- **Zero operational overhead** with no dedicated infrastructure
- **Integration with Notion** without external database requirements

## ✨ The Solution

Built a serverless webhook-based system using Val.town that:
- Detects duplicates instantly using SQLite indexing (O(1) lookups)
- Tags all matching records automatically via Notion API
- Requires zero maintenance after deployment

## 🚀 Key Features

- ✅ **Real-time duplicate detection** (< 1 second response time)
- ✅ **Case-insensitive matching** with string normalization
- ✅ **Tags ALL duplicates**, not just pairs (if 3+ records match, all get tagged)
- ✅ **Handles 150k+ existing records** via optimized backfill strategy
- ✅ **Scalable** to 200+ daily insertions with automatic rate limiting
- ✅ **Serverless** architecture with zero maintenance overhead

## 🏗️ Architecture

```
Notion Database → Notion Automation → Val.town Webhook Handler
                                      ↓
                               SQLite Index (case-insensitive)
                                      ↓
                               Notion API (tag duplicates)
```

### How It Works

1. **New page created** in Notion database
2. **Notion automation** triggers webhook to Val.town
3. **Webhook handler** normalizes the name and queries SQLite index
4. **If duplicate found:**
   - Tags the new page with "Duplicate"
   - Tags all existing matching pages
   - Adds new page to index
5. **If unique:**
   - Adds page to index for future detection

## 💡 Technical Highlights & Challenges

### Challenge 1: Platform Execution Limits
**Problem:** Val.town free tier has a 1-minute execution timeout, making it impossible to process 150k+ records in a single run.

**Solution:** Designed a two-phase backfill approach:
- **Phase 1 (Local):** Runs on developer machine to fetch all pages, detect duplicates in-memory, and tag them
- **Phase 2 (Val.town):** Scheduled Val runs in 15-minute intervals to build SQLite index incrementally

### Challenge 2: API Rate Limiting
**Problem:** Notion API limits to 3 requests/second, risking 429 errors during high-volume operations.

**Solution:** Implemented exponential backoff retry mechanism:
- Detects rate limit errors (HTTP 429)
- Automatically retries with exponentially increasing delays
- Continues processing without data loss

### Challenge 3: SQLite Concurrency on Serverless
**Problem:** Multiple webhook calls could cause SQLite lock contention on serverless platform.

**Solution:** 
- Proper transaction handling with retry logic
- Optimized index design with `COLLATE NOCASE` for case-insensitive lookups
- Idempotent operations to prevent duplicate entries

### Challenge 4: Client-Specific Property Names
**Problem:** Client used Russian property names ("клиент" instead of "Name") and a Select field instead of Multi-select.

**Solution:** 
- Made property mapping configurable
- Adapted tagging logic to handle Select vs. Multi-select property types
- Maintained backward compatibility with standard implementations

## 📊 Results & Impact

- ✅ **Successfully deployed to production**
- ✅ **Processing 150k+ records** with automated duplicate detection
- ✅ **Zero-maintenance operation** (serverless, no infrastructure to manage)
- ✅ **< 1 second response time** for real-time detection
- ✅ **Production-stable** with built-in error handling and retry logic

## 🛠️ Technologies Used

- **Runtime:** Deno/TypeScript on Val.town (serverless platform)
- **Database:** SQLite with `COLLATE NOCASE` indexing for case-insensitive lookups
- **APIs:** Notion API v2022-06-28
- **Deployment:** Val.town webhooks with automated scaling

## 📁 Project Structure

```
notion-duplicate-checker/
├── duplicate-checker-deploy.ts    # Main webhook handler (production)
├── index-builder-deploy.ts        # SQLite index builder (production)
├── backfill-local-deploy.ts       # Local backfill script (production)
├── docs/                          # Deployment documentation
│   ├── DEPLOYMENT-CHECKLIST.md    # Step-by-step deployment guide
│   ├── HANDOFF.md                 # Production handoff documentation
│   ├── TESTING.md                 # Testing checklist and scenarios
│   └── ...
├── package.json                   # Project metadata
├── .gitignore                     # Git ignore rules
└── README.md                      # This file
```

## 🎓 Lessons Learned

### Understanding Platform Constraints Early
Initially attempted to run the entire backfill on Val.town, hitting the 1-minute timeout limit repeatedly. Learning the platform constraints upfront would have saved iteration time.

### Iterative Problem-Solving
Developed three different backfill approaches before arriving at the optimal two-phase solution:
1. ❌ **Chunked Val.town approach** (too slow, 4-6 hours)
2. ❌ **Python CSV-based approach** (required downtime, fragile)
3. ✅ **Local + incremental approach** (fast, reliable, no downtime)

### Balancing Perfect vs. Practical
While fuzzy matching (e.g., "Jon Smith" vs "John Smith") would be ideal, exact case-insensitive matching met the 80/20 rule for practical deployment.

### Working Within Third-Party Limitations
Learned to design around platform constraints (execution timeouts, rate limits) rather than fighting them. The two-phase backfill is a good example of creative problem-solving within limitations.

## 🚀 Quick Start

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup instructions.

### Prerequisites
- Val.town account (free tier works)
- Notion workspace with admin access
- Deno installed (for local backfill)

### Quick Deploy

1. **Create Notion Integration** at https://www.notion.so/my-integrations
2. **Deploy webhook handler** to Val.town:
   ```bash
   vt push duplicate-checker-deploy.ts
   ```
3. **Set environment variables** in Val.town:
   ```bash
   vt secret set NOTION_TOKEN your_token
   vt secret set NOTION_DATABASE_ID your_db_id
   ```
4. **Configure Notion automation** to send webhooks on page creation
5. **Run backfill** (optional, for existing records):
   ```bash
   deno run --allow-net --allow-env backfill-local-deploy.ts
   ```

## 📖 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical deep-dive and design decisions
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide
- **[docs/TESTING.md](docs/TESTING.md)** - Testing checklist and scenarios
- **[docs/HANDOFF.md](docs/HANDOFF.md)** - Production handoff guide

## 🤝 Contributing

This is a portfolio project showcasing production-ready serverless development. Feel free to fork and adapt for your own use cases.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 📞 Questions?

For technical questions about the implementation or deployment, see the documentation in the `docs/` folder.

---

**Note:** This project was built for a production client deployment and has been sanitized to remove sensitive information (tokens, database IDs, URLs) for portfolio purposes.
