/* Team tables + fuzzy team-name matching for NFL, college football, NBA and MLB (works in Node and the browser).
 *  - NFL / NBA / MLB: fixed tables (a team ESPN sends that isn't in a table registers itself, so nothing breaks).
 *  - CFB: ~134 FBS teams register themselves from ESPN game data (registerGame), so nothing goes stale.
 *  matchTeam(text, league)  league = 'nfl' | 'cfb' | 'nba' | 'mlb' | undefined (undefined tries NFL, then CFB; NBA / MLB need an explicit league).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NFLTeams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // [abbr, city, nickname, extra aliases (comma separated), hasUniqueCity]
  const DATA = [
    ['ARI', 'Arizona', 'Cardinals', 'cards,ari,arz', 1],
    ['ATL', 'Atlanta', 'Falcons', 'atl', 1],
    ['BAL', 'Baltimore', 'Ravens', 'bal,balt', 1],
    ['BUF', 'Buffalo', 'Bills', 'buf', 1],
    ['CAR', 'Carolina', 'Panthers', 'car,carolina panthers', 1],
    ['CHI', 'Chicago', 'Bears', 'chi', 1],
    ['CIN', 'Cincinnati', 'Bengals', 'cin,cincy', 1],
    ['CLE', 'Cleveland', 'Browns', 'cle', 1],
    ['DAL', 'Dallas', 'Cowboys', 'dal', 1],
    ['DEN', 'Denver', 'Broncos', 'den', 1],
    ['DET', 'Detroit', 'Lions', 'det', 1],
    ['GB', 'Green Bay', 'Packers', 'gb,gnb,green bay', 1],
    ['HOU', 'Houston', 'Texans', 'hou', 1],
    ['IND', 'Indianapolis', 'Colts', 'ind,indy', 1],
    ['JAX', 'Jacksonville', 'Jaguars', 'jax,jac,jags', 1],
    ['KC', 'Kansas City', 'Chiefs', 'kc,kan,kcc', 1],
    ['LV', 'Las Vegas', 'Raiders', 'lv,lvr,oakland raiders,oakland,vegas,lv raiders', 1],
    ['LAC', 'Los Angeles', 'Chargers', 'lac,la chargers,los angeles chargers,san diego chargers', 0],
    ['LAR', 'Los Angeles', 'Rams', 'lar,la rams,los angeles rams', 0],
    ['MIA', 'Miami', 'Dolphins', 'mia,fins', 1],
    ['MIN', 'Minnesota', 'Vikings', 'min,vikes', 1],
    ['NE', 'New England', 'Patriots', 'ne,nwe,pats', 1],
    ['NO', 'New Orleans', 'Saints', 'no,nor,nola', 1],
    ['NYG', 'New York', 'Giants', 'nyg,ny giants,new york giants,g men', 0],
    ['NYJ', 'New York', 'Jets', 'nyj,ny jets,new york jets', 0],
    ['PHI', 'Philadelphia', 'Eagles', 'phi,philly', 1],
    ['PIT', 'Pittsburgh', 'Steelers', 'pit', 1],
    ['SF', 'San Francisco', '49ers', 'sf,sfo,niners,forty niners,san fran', 1],
    ['SEA', 'Seattle', 'Seahawks', 'sea', 1],
    ['TB', 'Tampa Bay', 'Buccaneers', 'tb,tam,tampa,bucs,tampa bay buccaneers', 1],
    ['TEN', 'Tennessee', 'Titans', 'ten', 1],
    ['WSH', 'Washington', 'Commanders', 'wsh,was,wft,washington football team', 1],
  ];

  // [abbr, city, nickname, extra aliases (comma separated), hasUniqueCity] — abbreviations follow ESPN; others are aliases.
  const NBA = [
    ['ATL', 'Atlanta', 'Hawks', 'atl', 1],
    ['BOS', 'Boston', 'Celtics', 'bos,celts', 1],
    ['BKN', 'Brooklyn', 'Nets', 'bkn,bk,bro', 1],
    ['CHA', 'Charlotte', 'Hornets', 'cha,cho', 1],
    ['CHI', 'Chicago', 'Bulls', 'chi', 1],
    ['CLE', 'Cleveland', 'Cavaliers', 'cle,cavs', 1],
    ['DAL', 'Dallas', 'Mavericks', 'dal,mavs', 1],
    ['DEN', 'Denver', 'Nuggets', 'den', 1],
    ['DET', 'Detroit', 'Pistons', 'det', 1],
    ['GS', 'Golden State', 'Warriors', 'gs,gsw,golden st,dubs', 1],
    ['HOU', 'Houston', 'Rockets', 'hou', 1],
    ['IND', 'Indiana', 'Pacers', 'ind', 1],
    ['LAC', 'Los Angeles', 'Clippers', 'lac,la clippers,los angeles clippers,clips', 0],
    ['LAL', 'Los Angeles', 'Lakers', 'lal,la lakers,los angeles lakers', 0],
    ['MEM', 'Memphis', 'Grizzlies', 'mem,grizz', 1],
    ['MIA', 'Miami', 'Heat', 'mia', 1],
    ['MIL', 'Milwaukee', 'Bucks', 'mil', 1],
    ['MIN', 'Minnesota', 'Timberwolves', 'min,wolves,twolves,t wolves', 1],
    ['NO', 'New Orleans', 'Pelicans', 'no,nop,nola,pels', 1],
    ['NY', 'New York', 'Knicks', 'ny,nyk,knickerbockers', 1],
    ['OKC', 'Oklahoma City', 'Thunder', 'okc,oklahoma city thunder', 1],
    ['ORL', 'Orlando', 'Magic', 'orl', 1],
    ['PHI', 'Philadelphia', '76ers', 'phi,sixers,philly,seventy sixers', 1],
    ['PHX', 'Phoenix', 'Suns', 'phx,pho', 1],
    ['POR', 'Portland', 'Trail Blazers', 'por,blazers,trailblazers,trail blazers', 1],
    ['SAC', 'Sacramento', 'Kings', 'sac', 1],
    ['SA', 'San Antonio', 'Spurs', 'sa,sas', 1],
    ['TOR', 'Toronto', 'Raptors', 'tor', 1],
    ['UTAH', 'Utah', 'Jazz', 'utah,uta', 1],
    ['WSH', 'Washington', 'Wizards', 'wsh,was', 1],
  ];
  const MLB = [
    ['ARI', 'Arizona', 'Diamondbacks', 'ari,az,dbacks,d backs,snakes', 1],
    ['ATH', 'Athletics', 'Athletics', 'ath,oak,as,a s,oakland,oakland athletics,oakland as,sacramento athletics,sacramento', 1],
    ['ATL', 'Atlanta', 'Braves', 'atl', 1],
    ['BAL', 'Baltimore', 'Orioles', 'bal,os,o s', 1],
    ['BOS', 'Boston', 'Red Sox', 'bos,redsox', 1],
    ['CHC', 'Chicago', 'Cubs', 'chc,chi cubs,chicago cubs', 0],
    ['CHW', 'Chicago', 'White Sox', 'chw,cws,chisox,chi white sox,chicago white sox,whitesox', 0],
    ['CIN', 'Cincinnati', 'Reds', 'cin', 1],
    ['CLE', 'Cleveland', 'Guardians', 'cle', 1],
    ['COL', 'Colorado', 'Rockies', 'col', 1],
    ['DET', 'Detroit', 'Tigers', 'det', 1],
    ['HOU', 'Houston', 'Astros', 'hou', 1],
    ['KC', 'Kansas City', 'Royals', 'kc,kcr', 1],
    ['LAA', 'Los Angeles', 'Angels', 'laa,ana,la angels,los angeles angels,anaheim,anaheim angels', 0],
    ['LAD', 'Los Angeles', 'Dodgers', 'lad,la dodgers,los angeles dodgers', 0],
    ['MIA', 'Miami', 'Marlins', 'mia', 1],
    ['MIL', 'Milwaukee', 'Brewers', 'mil', 1],
    ['MIN', 'Minnesota', 'Twins', 'min', 1],
    ['NYM', 'New York', 'Mets', 'nym,ny mets,new york mets', 0],
    ['NYY', 'New York', 'Yankees', 'nyy,ny yankees,new york yankees,yanks', 0],
    ['PHI', 'Philadelphia', 'Phillies', 'phi,philly', 1],
    ['PIT', 'Pittsburgh', 'Pirates', 'pit', 1],
    ['SD', 'San Diego', 'Padres', 'sd,sdp', 1],
    ['SF', 'San Francisco', 'Giants', 'sf,sfg,sf giants,san francisco giants', 1],
    ['SEA', 'Seattle', 'Mariners', 'sea,ms', 1],
    ['STL', 'St. Louis', 'Cardinals', 'stl,saint louis,cards,st louis cardinals', 1],
    ['TB', 'Tampa Bay', 'Rays', 'tb,tbr,tampa,tampa bay rays', 1],
    ['TEX', 'Texas', 'Rangers', 'tex', 1],
    ['TOR', 'Toronto', 'Blue Jays', 'tor,bluejays,jays', 1],
    ['WSH', 'Washington', 'Nationals', 'wsh,was,wsn,nats', 1],
  ];

  /* Common college slang -> text that matches an ESPN short name / location (after norm). CFB only. */
  const CFB_SLANG = {
    'bama': 'alabama', 'roll tide': 'alabama', 'uga': 'georgia', 'ole miss': 'ole miss', 'olemiss': 'ole miss', 'mississippi': 'ole miss',
    'miss state': 'mississippi state', 'mich state': 'michigan state', 'penn st': 'penn state', 'nc state': 'nc state',
    'north carolina state': 'nc state', 'texas am': 'texas a m', 'tamu': 'texas a m', 'aggies': 'texas a m', 'cuse': 'syracuse',
    'pitt': 'pittsburgh', 'cal': 'california', 'cal berkeley': 'california', 'miami fl': 'miami', 'miami florida': 'miami',
    'miami ohio': 'miami oh', 'umass': 'massachusetts', 'uconn': 'connecticut', 'appalachian state': 'app state', 'app st': 'app state',
    'southern cal': 'usc', 'hawaii': 'hawaii', 'la tech': 'louisiana tech', 'ul lafayette': 'louisiana', 'louisiana lafayette': 'louisiana',
    'ul monroe': 'louisiana monroe', 'ohio st': 'ohio state', 'florida st': 'florida state', 'oklahoma st': 'oklahoma state',
  };

  /* Two-way spellings where ESPN's short name differs from the common long form. */
  const CFB_ALT = { 'connecticut': 'uconn', 'uconn': 'connecticut', 'massachusetts': 'umass', 'umass': 'massachusetts' };

  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* old engine */ }
    t = t.replace(/['’`.]/g, '')                         // hawai'i, N.C. State
      .replace(/^\s*(?:no\s*)?[#(]?\d{1,2}[)]?\s+(?=[a-z])/, '')  // "#5 Georgia", "(5) Georgia", "No. 5 Georgia"
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\bst\b/g, 'state')                        // "Ohio St" -> "ohio state", "Boise St" -> "boise state"
      .replace(/\s+/g, ' ')
      .trim();
    return t;
  }

  function makeRegistry() { return { EXACT: Object.create(null), PRI: Object.create(null), LONG: [], dirty: false, INFO: Object.create(null), SEEN: Object.create(null), BLOCK: Object.create(null) }; }
  const REG = { nfl: makeRegistry(), cfb: makeRegistry(), nba: makeRegistry(), mlb: makeRegistry() };
  const LEAGUES = ['nfl', 'cfb', 'nba', 'mlb'];

  /* priority: 3 = abbreviation, 2 = city/short name/full name, 1 = nickname. Equal-priority clashes become ambiguous and are dropped. */
  function addAlias(R, alias, abbr, pri) {
    const a = norm(alias);
    if (!a || R.BLOCK[a]) return;
    const cur = R.EXACT[a];
    if (cur === undefined) { R.EXACT[a] = abbr; R.PRI[a] = pri; R.dirty = true; return; }
    if (cur === abbr) { if (pri > R.PRI[a]) R.PRI[a] = pri; return; }
    if (pri > R.PRI[a]) { R.EXACT[a] = abbr; R.PRI[a] = pri; R.dirty = true; }
    else if (pri === R.PRI[a]) { delete R.EXACT[a]; delete R.PRI[a]; R.BLOCK[a] = true; R.dirty = true; }
  }

  function rebuildLong(R) {
    R.LONG = [];
    Object.keys(R.EXACT).forEach(function (a) { if (a.length >= 4 && !/^\d+$/.test(a)) R.LONG.push([a, R.EXACT[a]]); });
    R.LONG.sort(function (x, y) { return y[0].length - x[0].length; });
    R.dirty = false;
  }

  /* Fixed tables: NFL, NBA, MLB */
  function loadTable(league, rows) {
    const R = REG[league];
    rows.forEach(function (row) {
      const abbr = row[0], city = row[1], nick = row[2], extra = row[3], uniq = row[4];
      R.INFO[abbr] = { abbr: abbr, city: city, nick: nick, full: city + ' ' + nick };
      addAlias(R, city + ' ' + nick, abbr, 2); addAlias(R, nick, abbr, 2); addAlias(R, abbr, abbr, 3);
      if (uniq) addAlias(R, city, abbr, 2);
      extra.split(',').forEach(function (e) { if (e) addAlias(R, e, abbr, 2); });
    });
  }
  loadTable('nfl', DATA); loadTable('nba', NBA); loadTable('mlb', MLB);

  /* Register one team {abbr, name, short, nick, location} (college teams, or a pro team missing from a table). Idempotent. */
  function registerTeam(league, t) {
    const R = REG[league]; if (!R || !t || !t.abbr) return;
    const abbr = t.abbr, key = abbr + '|' + (t.name || '') + '|' + (t.short || '');
    if (R.SEEN[key]) return; R.SEEN[key] = true;
    const short = t.short || t.location || t.name || abbr;
    if (!R.INFO[abbr]) R.INFO[abbr] = { abbr: abbr, city: t.location || short, nick: t.nick || '', short: short, full: t.name || short };
    addAlias(R, abbr, abbr, 3);
    if (t.name) addAlias(R, t.name, abbr, 2);
    if (t.short) addAlias(R, t.short, abbr, 2);
    if (t.location) addAlias(R, t.location, abbr, 2);
    if (t.nick) addAlias(R, t.nick, abbr, 1);     // "Tigers" is shared by many schools -> dropped as ambiguous
    // re-check slang that points at this team's names
  }

  function registerGame(g) {
    if (!g) return;
    const league = LEAGUES.indexOf(g.league) >= 0 ? g.league : 'nfl';
    if (league === 'nfl') return;                  // NFL uses the fixed table
    ['away', 'home'].forEach(function (s) {
      const t = g[s]; if (!t) return;
      // pro teams are already in a table: only register one ESPN sends that we don't know yet
      if (league !== 'cfb' && REG[league].INFO[t.abbr]) return;
      registerTeam(league, t);
    });
  }

  /* "S Carolina" / "W Virginia" / "C Michigan" -> south / west / central ... (college slips abbreviate the direction) */
  const DIRS = { n: 'north', s: 'south', e: 'east', w: 'west', c: 'central' };
  function expandDir(n) { return n.replace(/^([nsewc]) (?=[a-z])/, function (m, c) { return DIRS[c] + ' '; }); }
  /* Text that is clearly a college team: stops the loose NFL city matching ("South Carolina" is not Carolina, "Arizona State" is not Arizona). */
  const COLLEGEISH = /\b(state|tech|university|college)\b|^(north|south|east|west|central|[nsewc]) /;

  function matchIn(R, str, league, strict) {
    const n0 = norm(str);
    if (!n0) return null;
    if (R.dirty) rebuildLong(R);
    // Try the text as written first, then slang / alternate spellings (ESPN says "UConn", slips may say "Connecticut").
    const cands = [n0];
    if (league === 'cfb') {
      if (CFB_SLANG[n0]) cands.push(CFB_SLANG[n0]);
      if (CFB_ALT[n0]) cands.push(CFB_ALT[n0]);
      const ex = expandDir(n0); if (ex !== n0) { cands.push(ex); if (CFB_SLANG[ex]) cands.push(CFB_SLANG[ex]); }
    }
    for (let c = 0; c < cands.length; c++) if (R.EXACT[cands[c]]) return R.EXACT[cands[c]];   // exact beats fuzzy
    if (strict || (league === 'nfl' && COLLEGEISH.test(n0))) return null;   // exact names only (see above)
    for (let c = 0; c < cands.length; c++) {
      const n = cands[c];
      for (let i = 0; i < R.LONG.length; i++) {
        const a = R.LONG[i][0];
        if (n === a || n.indexOf(' ' + a + ' ') >= 0 || n.startsWith(a + ' ') || n.endsWith(' ' + a)) return R.LONG[i][1];
      }
    }
    return null;
  }

  /* strict = exact team names / abbreviations only, no fuzzy "contains" matching (used when crossing leagues as a fallback) */
  function matchTeam(str, league, strict) {
    if (REG[league]) return matchIn(REG[league], str, league, strict);
    // no league given: football only (NBA / MLB names overlap too much, so those need an explicit league)
    return matchIn(REG.nfl, str, 'nfl', strict) || matchIn(REG.cfb, str, 'cfb', strict);
  }

  function infoFor(abbr, league) {
    if (league && REG[league] && REG[league].INFO[abbr]) return REG[league].INFO[abbr];
    for (let i = 0; i < LEAGUES.length; i++) if (REG[LEAGUES[i]].INFO[abbr]) return REG[LEAGUES[i]].INFO[abbr];
    return null;
  }
  function name(abbr, league) {
    const i = infoFor(abbr, league);
    if (!i) return abbr || '';
    return league === 'cfb' || (!league && !REG.nfl.INFO[abbr] && !REG.nba.INFO[abbr] && !REG.mlb.INFO[abbr]) ? (i.short || i.city || abbr) : (i.nick || i.short || i.city || abbr);
  }
  function fullName(abbr, league) { const i = infoFor(abbr, league); return i ? i.full : abbr || ''; }

  return { matchTeam: matchTeam, name: name, fullName: fullName, norm: norm, registerGame: registerGame, registerTeam: registerTeam, LEAGUES: LEAGUES, INFO: REG.nfl.INFO, CFB_INFO: REG.cfb.INFO, NBA_INFO: REG.nba.INFO, MLB_INFO: REG.mlb.INFO };
});