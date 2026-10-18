# Parlay Tracker

Upload sportsbook screenshots and track individual NFL bet legs against ESPN scoreboard and box-score data.

- Reads screenshots with OpenAI vision and returns structured bet data.
- Supports moneylines, spreads, totals, player props, TD markets, and more.
- Tracks multiple bets, with editable legs and manual corrections.
- ESPN scoreboard and box scores refresh during games.
- Demo mode works without an API key.

## Run locally (Node 18+)

1. Install Node.js 18 or newer: https://nodejs.org/
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (or paste your key in Settings).
3. Run `npm start` and open http://localhost:3000.

No `npm install` is required. Windows: double-click `start.bat`.

## Public hosting

Set `OPENAI_API_KEY`, `OPENAI_MODEL` (optional), and a strong `APP_PASSWORD` in your host's environment settings. The password protects the public app and prevents strangers from using your API key. Keep `.env` out of source control.

Render can host this as a Node web service with build command `npm test` and start command `npm start`. Set the host to use its provided `PORT`; the server binds to `0.0.0.0` automatically on Render. Free services can sleep when idle, and local files are ephemeral, so use this as a personal test deployment rather than a production service.

## Notes / limitations

- ESPN endpoints are unofficial and may change; real live feed compatibility must be tested after deployment.
- Verify extracted bet legs and scores against your sportsbook and ESPN.
- Fantasy-point props currently use the scoring system encoded in the app; sportsbook scoring can differ.
- Props without a matching box-score field (e.g. longest completion) may require manual tracking.
- Automated tests use fixture/mock data and do not prove real API integration.
