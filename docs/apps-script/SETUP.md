# Apps Script Deployment Guide

## Files to copy into your Apps Script project

1. `order-handler.gs` → paste into `Code.gs` (replace all)
2. `team-messaging-handlers.gs` → create new file `team-messaging.gs` (paste all)

## Script Properties (REQUIRED)

Go to: **Project settings** (gear icon) → **Script properties** → **Add property**

| Property | Value | Notes |
|----------|-------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather | Same value as the GitHub Secret `TELEGRAM_BOT_TOKEN` |

Without this, all Telegram sends will silently fail (shows "no" in the spreadsheet).

## How to deploy

1. Save all files in the Apps Script editor
2. Click **Deploy** → **Manage deployments**
3. Click the pencil icon on your active deployment
4. Change version to **New version**
5. Click **Deploy**

The URL stays the same — no frontend changes needed.

## Sheet tabs (auto-created on first use)

- `Announcements` — timestamp, author, subject, body, priority, telegram_sent, dedup_key
- `DirectMessages` — timestamp, from_user, to_user, text, telegram_notified
- `MemberNotes` — timestamp, member, author, category, text
- `TrainingRecords` — timestamp, member, author, type, text, module_id
- `ChatMessages` — timestamp, channel, from_user, text, msg_type, to_user
- `TeamMembers` — token, name, password_hash, email, phone, role, created_at, total_scans, telegram_username

## Troubleshooting Telegram sends

If `telegram_sent` shows "no" in the Announcements sheet:
1. Check Script Properties has `TELEGRAM_BOT_TOKEN`
2. Check Execution log (Executions tab in Apps Script) for errors
3. Verify the bot is still a member/admin of @seedtheword group
4. Verify thread ID 553 exists (announcements topic)
