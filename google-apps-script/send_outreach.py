#!/usr/bin/env python3
"""
NWES Optometrist Outreach — Token Generator
============================================
Run this script from Claude Code to:
  1. Read providers.csv
  2. Filter optometrists who are unconfirmed AND have an email on file
  3. Generate a UUID token per provider (skips any who already have an active token)
  4. Commit updated tokens.json to GitHub
  5. Print a summary for Claude to use when creating Gmail drafts

Usage (from Claude Code terminal):
  python3 "google-apps-script/send_outreach.py"

Requirements:
  - GITHUB_TOKEN env var set, OR paste your PAT into the GITHUB_TOKEN constant below
  - Run from the root of the nwes-providers repo (or any directory — it uses absolute paths)

To switch to a professional sending email later:
  Update REPLY_EMAIL below — this is printed in the summary for Claude's reference only.
"""

import csv
import json
import uuid
import base64
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

GH_OWNER      = 'LuchoClaudeTools'
GH_REPO       = 'nwes-providers'
GH_BRANCH     = 'main'
GITHUB_TOKEN  = os.environ.get('GITHUB_TOKEN', '')  # set env var or paste PAT here
TOKEN_TTL     = 30  # days
APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbynTkas8VfoXuDgEwJcKPau1oIFgok7O_xMh2xdpHFuRPf0BEsVCHDtIwW6hTy3ZaTJWQ/exec'
REPLY_EMAIL   = 'lucho.claudetools@gmail.com'  # update when switching to practice email

# Repo root = parent of this script's directory
REPO_ROOT     = Path(__file__).parent.parent
CSV_PATH      = REPO_ROOT / 'providers.csv'
TOKENS_PATH   = REPO_ROOT / 'tokens.json'

# ── GitHub API helpers ────────────────────────────────────────────────────────

def gh_headers():
    if not GITHUB_TOKEN:
        print("ERROR: No GitHub token found. Set the GITHUB_TOKEN environment variable.")
        print("  Example: GITHUB_TOKEN=ghp_... python3 google-apps-script/send_outreach.py")
        sys.exit(1)
    return {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
    }

def gh_get(path):
    url = f'https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/contents/{path}?ref={GH_BRANCH}'
    req = urllib.request.Request(url, headers=gh_headers())
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def gh_put(path, content, message, sha=None):
    url = f'https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/contents/{path}'
    payload = {
        'message': message,
        'content': base64.b64encode(content.encode()).decode(),
        'branch': GH_BRANCH,
    }
    if sha:
        payload['sha'] = sha
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=gh_headers(), method='PUT')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

# ── CSV helpers ───────────────────────────────────────────────────────────────

def load_providers():
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("NWES Outreach Token Generator")
    print("=" * 50)

    # Load providers
    providers = load_providers()
    candidates = [
        p for p in providers
        if p.get('specialty', '').strip() == 'Optometrist'
        and p.get('confirmed', '').strip().lower() != 'true'
        and p.get('email', '').strip()
    ]

    if not candidates:
        print("\nNo eligible providers found.")
        print("(Eligible = Optometrist + not confirmed + has email address)")
        print("\nNext step: add email addresses to providers via the web app, then re-run.")
        return

    print(f"\nFound {len(candidates)} eligible provider(s):\n")

    # Load current tokens.json from GitHub
    try:
        gh_data = gh_get('tokens.json')
        tokens_raw = base64.b64decode(gh_data['content']).decode()
        tokens = json.loads(tokens_raw)
        tokens_sha = gh_data['sha']
    except Exception as e:
        print(f"ERROR loading tokens.json from GitHub: {e}")
        sys.exit(1)

    # Also load local tokens.json to stay in sync
    with open(TOKENS_PATH, 'r') as f:
        local_tokens = json.load(f)

    # Merge (GitHub is source of truth)
    tokens = {**local_tokens, **tokens}

    # Find providers who already have an active (unused, non-expired) token
    now = datetime.now(timezone.utc)
    active_provider_ids = {
        entry['providerId']
        for entry in tokens.values()
        if not entry.get('used') and datetime.fromisoformat(entry['expiresAt']) > now
    }

    new_tokens = {}
    outreach_list = []

    for p in candidates:
        pid = str(p['id'])
        email = p['email'].strip()
        name = p['displayName'].strip()

        if pid in active_provider_ids:
            print(f"  SKIP  {name} — active token already exists")
            continue

        token = str(uuid.uuid4())
        sent_at = now.isoformat()
        expires_at = (now + timedelta(days=TOKEN_TTL)).isoformat()

        new_tokens[token] = {
            'providerId': pid,
            'email': email,
            'sentAt': sent_at,
            'expiresAt': expires_at,
            'used': False,
        }

        form_url = f'{APPS_SCRIPT_URL}?token={token}'
        outreach_list.append({
            'name': name,
            'practice': p.get('practice', '').strip(),
            'email': email,
            'phone': p.get('phone', '').strip(),
            'address': p.get('address', '').strip(),
            'city': p.get('city', '').strip(),
            'website': p.get('website', '').strip(),
            'catComanage': p.get('catComanage', '').strip(),
            'glaucTC': p.get('glaucTC', '').strip(),
            'token': token,
            'formUrl': form_url,
        })
        print(f"  TOKEN {name} <{email}>")

    if not new_tokens:
        print("\nAll eligible providers already have active tokens. Nothing to do.")
        return

    # Merge and save
    tokens.update(new_tokens)
    updated_json = json.dumps(tokens, indent=2)

    # Write locally
    with open(TOKENS_PATH, 'w') as f:
        f.write(updated_json)

    # Commit to GitHub
    print(f"\nCommitting tokens.json to GitHub ({len(new_tokens)} new token(s))...")
    try:
        gh_put(
            'tokens.json',
            updated_json,
            f'Outreach tokens: {len(new_tokens)} provider(s) — {now.strftime("%Y-%m-%d")}',
            sha=tokens_sha,
        )
        print("Committed successfully.")
    except Exception as e:
        print(f"ERROR committing to GitHub: {e}")
        print("tokens.json was saved locally but NOT pushed to GitHub.")
        sys.exit(1)

    # Print summary for Claude to use when creating Gmail drafts
    print("\n" + "=" * 50)
    print("OUTREACH SUMMARY — paste to Claude for Gmail draft creation")
    print("=" * 50)
    print(f"Reply-to: {REPLY_EMAIL}")
    print(f"Token TTL: {TOKEN_TTL} days\n")

    for i, p in enumerate(outreach_list, 1):
        print(f"--- Provider {i} ---")
        print(f"Name:       {p['name']}")
        print(f"Practice:   {p['practice']}")
        print(f"Email:      {p['email']}")
        print(f"Phone:      {p['phone']}")
        print(f"Address:    {p['address']}, {p['city']}")
        print(f"Website:    {p['website']}")
        print(f"CatCoMgmt:  {p['catComanage']}")
        print(f"GlaucTC:    {p['glaucTC']}")
        print(f"Form URL:   {p['formUrl']}")
        print()

    print("=" * 50)
    print(f"Next step: ask Claude to create Gmail drafts for the {len(outreach_list)} provider(s) above.")

if __name__ == '__main__':
    main()
