"""
Per-member notification routing.

Reads a member's notify_pref from the TeamMembers sheet (via the Apps Script
web app) and sends a message through their preferred channel:
  - email: sends via the Apps Script MailApp bridge
  - sms: sends via carrier email-to-SMS gateway
  - telegram: sends a Telegram DM (if telegram_username is set)
  - none: skips silently

Usage:
    from notify_member import notify_member
    notify_member(member_name, subject, body_text, body_html=None)
"""

import os
import json
import requests

HANDLER_URL = os.environ.get("HANDLER_URL", "")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

# Carrier → email-to-SMS gateway domain
CARRIER_GATEWAYS = {
    "tmobile": "tmomail.net",
    "att": "txt.att.net",
    "verizon": "vtext.com",
    "sprint": "messaging.sprintpcs.com",
    "metro": "mymetropcs.com",
    "boost": "sms.myboostmobile.com",
    "cricket": "sms.cricketwireless.net",
    "mint": "mailmymobile.net",
    "visible": "vtext.com",
    "fi": "msg.fi.google.com",
}


def _post_to_handler(payload: dict) -> dict:
    """Post a JSON payload to the Apps Script handler."""
    if not HANDLER_URL:
        print("[notify_member] No HANDLER_URL set, skipping.")
        return {"ok": False, "error": "no handler url"}
    resp = requests.post(
        HANDLER_URL,
        data=json.dumps(payload),
        headers={"Content-Type": "text/plain;charset=utf-8"},
        timeout=30,
        allow_redirects=True,
    )
    try:
        return resp.json()
    except Exception:
        return {"ok": False, "error": resp.text[:200]}


def get_member_profile(member_name: str) -> dict | None:
    """Fetch a member's profile from TeamMembers sheet via getAdminMembers."""
    res = _post_to_handler({
        "action": "getAdminMembers",
        "passphrase_hash": os.environ.get("ADMIN_HASH", ""),
    })
    if not res.get("ok") or not res.get("members"):
        return None
    for m in res["members"]:
        if m.get("name", "").lower().strip() == member_name.lower().strip():
            return m
    return None


def notify_member(
    member_name: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
):
    """
    Send a notification to a team member via their preferred channel.
    Falls back to email if preferred channel fails or isn't configured.
    """
    profile = get_member_profile(member_name)
    if not profile:
        print(f"[notify_member] Member '{member_name}' not found in TeamMembers.")
        return False

    pref = (profile.get("notify_pref") or "email").lower().strip()
    email = (profile.get("email") or "").strip()
    phone = (profile.get("phone") or "").strip()
    carrier = (profile.get("carrier") or "").strip()
    telegram_username = (profile.get("telegram_username") or "").strip()

    if pref == "none":
        print(f"[notify_member] {member_name} has notifications disabled.")
        return True

    if pref == "telegram" and telegram_username:
        success = _send_telegram_dm(telegram_username, subject, body_text)
        if success:
            return True
        print(f"[notify_member] Telegram DM failed for {member_name}, falling back to email.")

    if pref == "sms" and phone and carrier:
        success = _send_sms(phone, carrier, body_text)
        if success:
            return True
        print(f"[notify_member] SMS failed for {member_name}, falling back to email.")

    # Default: email
    if email:
        return _send_email(email, subject, body_text, body_html)
    else:
        print(f"[notify_member] No email for {member_name}, cannot notify.")
        return False


def _send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Send email via the Apps Script MailApp bridge."""
    payload = {
        "type": "weekly-digest-email",
        "to": to,
        "subject": subject,
        "text": body_text,
        "html": body_html or body_text,
        "name": "",
    }
    res = _post_to_handler(payload)
    return res.get("ok", False)


def _send_sms(phone: str, carrier: str, body_text: str) -> bool:
    """Send SMS via carrier email-to-SMS gateway."""
    # Clean phone number
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        print(f"[notify_member] Invalid phone number: {phone}")
        return False

    gateway = CARRIER_GATEWAYS.get(carrier.lower())
    if not gateway:
        print(f"[notify_member] Unknown carrier: {carrier}")
        return False

    sms_email = f"{digits}@{gateway}"
    payload = {
        "type": "admin-sms-cc",
        "to": sms_email,
        "body": body_text[:140],
    }
    res = _post_to_handler(payload)
    return res.get("ok", False)


def _send_telegram_dm(username: str, subject: str, body_text: str) -> bool:
    """Send a Telegram DM via Bot API (requires user to have started the bot)."""
    if not TELEGRAM_BOT_TOKEN:
        return False

    # We need the user's chat_id. For group bots, we can't DM by username alone.
    # This requires the user to have /start'd the bot first.
    # For now, we'll use the @username mention in the group as a fallback.
    # TODO: Implement chat_id lookup from a stored mapping
    print(f"[notify_member] Telegram DM to @{username} not yet supported (need chat_id mapping).")
    return False


if __name__ == "__main__":
    # Quick test
    import sys
    if len(sys.argv) >= 3:
        notify_member(sys.argv[1], "Test Notification", sys.argv[2])
    else:
        print("Usage: python notify_member.py 'Member Name' 'Test message'")
