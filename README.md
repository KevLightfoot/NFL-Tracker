# Parlay Tracker

Upload sportsbook screenshots and track individual bet legs (NFL, college football, NBA, MLB) against ESPN scoreboard and box-score data.

- Reads screenshots with OpenAI vision and returns structured bet data.
- Supports moneylines, spreads / run lines, totals, team totals, half / quarter / first-5-inning / first-inning markets, player props, TD scorers (football) and first basket (NBA).
- NBA props: points, rebounds, assists, threes, PRA combos, steals / blocks, double-doubles, fantasy. MLB props: hits, total bases, home runs, RBIs, runs, strikeouts, pitcher outs / earned runs and more.
- Tracks multiple bets, with editable legs and manual corrections.
- ESPN scoreboard and box scores refresh during games.

## Run locally (Node 18+)

1. Install Node.js 18 or newer: https://nodejs.org/
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (or paste your key in Settings).
3. Run `npm start` and open http://localhost:3000.

No `npm install` is required. Windows: double-click `start.bat`.

## Public hosting

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in Render environment settings. The public frontend is intended for GitHub Pages at `https://kevlightfoot.github.io/NFL-Tracker/`, with the API on Render. `ALLOWED_ORIGIN` defaults to `https://kevlightfoot.github.io`. Keep `.env` out of source control. The public API has lightweight per-IP limits, but these are not a substitute for robust paid-API abuse protection; monitor OpenAI usage and set billing limits.

Render can host this as a Node web service with build command `npm test` and start command `npm start`. Set the host to use its provided `PORT`; the server binds to `0.0.0.0` automatically on Render. Free services can sleep when idle, and local files are ephemeral, so use this as a personal test deployment rather than a production service.

## Notes / limitations

- NBA / MLB box-score parsing was written from ESPN's documented payload shape. Run `node scripts/probe-espn.js` once (needs internet) to check it against the live feed; it prints what it understood and which stats would fall back to manual entry.
- MLB singles / doubles / triples / total bases / stolen bases are counted from the play-by-play (ESPN's box score has no such columns); if the feed's plays don't add up to a player's hits, that stat asks for a manual value instead of guessing.
- NBA "first basket" ignores free throws; postponed or cancelled games void their legs.

- ESPN endpoints are unofficial and may change; real live feed compatibility must be tested after deployment.
- Verify extracted bet legs and scores against your sportsbook and ESPN.
- Fantasy-point props currently use the scoring system encoded in the app; sportsbook scoring can differ.
- Props without a matching box-score field (e.g. longest completion) may require manual tracking.
- Automated tests use fixture/mock data and do not prove real API integration.
