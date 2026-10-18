/* NFL team table + fuzzy team-name matching (works in Node and the browser). */
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

  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const EXACT = Object.create(null); // alias -> abbr (exact whole-string match)
  const LONG = []; // [alias, abbr] for word-boundary substring matching (len >= 4)
  const INFO = Object.create(null);

  DATA.forEach(function (row) {
    const abbr = row[0], city = row[1], nick = row[2], extra = row[3], uniq = row[4];
    INFO[abbr] = { abbr: abbr, city: city, nick: nick, full: city + ' ' + nick };
    const aliases = [norm(city + ' ' + nick), norm(nick), abbr.toLowerCase()];
    if (uniq) aliases.push(norm(city));
    extra.split(',').forEach(function (e) { if (e) aliases.push(norm(e)); });
    aliases.forEach(function (a) {
      if (!a) return;
      if (!EXACT[a]) EXACT[a] = abbr;
      if (a.length >= 4 && !/^\d+$/.test(a)) LONG.push([a, abbr]);
    });
  });
  LONG.sort(function (a, b) { return b[0].length - a[0].length; });

  function matchTeam(str) {
    const n = norm(str);
    if (!n) return null;
    if (EXACT[n]) return EXACT[n];
    for (let i = 0; i < LONG.length; i++) {
      const a = LONG[i][0];
      if (n === a || n.indexOf(' ' + a + ' ') >= 0 || n.startsWith(a + ' ') || n.endsWith(' ' + a)) return LONG[i][1];
    }
    return null;
  }

  function name(abbr) { return INFO[abbr] ? INFO[abbr].nick : abbr || ''; }
  function fullName(abbr) { return INFO[abbr] ? INFO[abbr].full : abbr || ''; }

  return { matchTeam: matchTeam, name: name, fullName: fullName, norm: norm, INFO: INFO };
});
