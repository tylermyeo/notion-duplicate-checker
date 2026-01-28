# Quick Reference Card

## 🔗 Important URLs

**Webhook URL:**
```
https://YOUR_USERNAME-YOUR_VAL_ID.web.val.run
```

**Val.town Dashboard:**
https://www.val.town/v/YOUR_USERNAME/duplicate-checker-v1

**Notion Database ID:**
```
YOUR_DATABASE_ID
```

## 🛠️ Common Commands

### View Logs
```bash
vt tail YOUR_USERNAME/duplicate-checker-v1
```

### Test Webhook Manually
```bash
curl -X POST https://YOUR_USERNAME-YOUR_VAL_ID.web.val.run \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": "test-123",
      "properties": {
        "Name": {
          "title": [{"plain_text": "Test Name"}]
        }
      }
    }
  }'
```

### Check Val.town Status
```bash
vt list | grep duplicate
```

## 📊 How It Works

1. **New page added** to Notion → Triggers automation
2. **Automation sends webhook** to Val.town
3. **Val.town checks SQLite** for matching name (case-insensitive)
4. **If duplicate found:**
   - Tags NEW page with "Duplicate"
   - Tags ALL existing matching pages with "Duplicate"
   - Adds new page to index
5. **If unique:**
   - Adds page to index
   - No tagging occurs

## 🐛 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Tags not appearing | Check Notion integration has "Update content" permission |
| Webhook not firing | Verify automation is ON in Notion |
| Duplicates not detected | Check Val.town logs - index may be empty |
| "Method not allowed" error | Normal when clicking "Run" - use curl or Notion instead |
| SQLite errors | Index may need recreation - contact support |

## ⚡ Key Files

- `notion-duplicate-checker.ts` - Main webhook handler
- `backfill-index.ts` - One-time script for existing 150k records
- `README.md` - Full documentation
- `TESTING.md` - Test scenarios
- `HANDOFF.md` - Production deployment guide

## 🎯 Expected Behavior

**First occurrence:** 
- "John Doe" added → Indexed, NO tag

**Second occurrence:**
- "John Doe" added → BOTH pages get "Duplicate" tag

**Third+ occurrence:**
- "John Doe" added → ALL pages (1st, 2nd, 3rd) get "Duplicate" tag

## 🔒 Security Notes

- Environment variables are stored securely in Val.town
- Never commit `.env` files to git
- Webhook URL is public but requires correct payload format
- Consider making Val private if code contains sensitive logic

## 📈 Monitoring

Check these metrics weekly:
- Total webhook calls (should match new pages added)
- Error rate (should be < 1%)
- Response time (should be < 1 second)
- SQLite database size (should grow slowly)

## 🆘 Emergency Actions

**If webhook stops working:**
1. Check Val.town logs for errors
2. Verify environment variables are still set
3. Test with curl command above
4. Check Notion integration permissions

**If index gets corrupted:**
1. Val.town will auto-recreate table on restart
2. May need to re-run backfill
3. Recent duplicates will still be detected

**If rate limited:**
1. Val.town has generous limits
2. Notion API: 3 req/second
3. Add delays if hitting limits
