/* Team tables + fuzzy team-name matching for NFL and college football (works in Node and the browser).
 *  - NFL: fixed 32-team table.
 *  - CFB: ~134 FBS teams register themselves from ESPN game data (registerGame), so nothing goes stale.
 *  matchTeam(text, league)  league = 'nfl' | 'cfb' | undefined (undefined tries NFL first, then CFB).
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
  const REG = { nfl: makeRegistry(), cfb: makeRegistry() };

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

  /* NFL: static table */
  DATA.forEach(function (row) {
    const abbr = row[0], city = row[1], nick = row[2], extra = row[3], uniq = row[4], R = REG.nfl;
    R.INFO[abbr] = { abbr: abbr, city: city, nick: nick, full: city + ' ' + nick };
    addAlias(R, city + ' ' + nick, abbr, 2); addAlias(R, nick, abbr, 2); addAlias(R, abbr, abbr, 3);
    if (uniq) addAlias(R, city, abbr, 2);
    extra.split(',').forEach(function (e) { if (e) addAlias(R, e, abbr, 2); });
  });

  /* CFB: register one team {abbr, name, short, nick, location}. Idempotent. */
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
    const league = g.league === 'cfb' ? 'cfb' : 'nfl';
    if (league !== 'cfb') return;                  // NFL uses the fixed table
    ['away', 'home'].forEach(function (s) { if (g[s]) registerTeam('cfb', g[s]); });
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
    if (league === 'nfl' || league === 'cfb') return matchIn(REG[league], str, league, strict);
    return matchIn(REG.nfl, str, 'nfl', strict) || matchIn(REG.cfb, str, 'cfb', strict);
  }

  function infoFor(abbr, league) { return (league && REG[league] && REG[league].INFO[abbr]) || REG.nfl.INFO[abbr] || REG.cfb.INFO[abbr] || null; }
  function name(abbr, league) {
    const i = infoFor(abbr, league);
    if (!i) return abbr || '';
    return league === 'cfb' || (!league && !REG.nfl.INFO[abbr]) ? (i.short || i.city || abbr) : i.nick;
  }
  function fullName(abbr, league) { const i = infoFor(abbr, league); return i ? i.full : abbr || ''; }

  return { matchTeam: matchTeam, name: name, fullName: fullName, norm: norm, registerGame: registerGame, registerTeam: registerTeam, INFO: REG.nfl.INFO, CFB_INFO: REG.cfb.INFO };
});