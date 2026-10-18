#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node 18+ is required: https://nodejs.org"; exit 1; }
[ -f .env ] || { cp .env.example .env; echo "Created .env — add OPENAI_API_KEY, or enter your key in the app Settings."; }
node server.js
