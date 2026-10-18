  /* Underdog/PrizePicks-style wording ("Higher 0.5 Anytime TD") often comes back as a generic prop with an
     unknown stat. Re-map touchdown-scorer legs from the slip text so they always track. */
  function fixTdLeg(leg) {
    if (!leg || !leg.player || leg.manual) return leg;
    if (['other', 'player_prop', 'anytime_td'].indexOf(leg.market) < 0) return leg;
    if (leg.market === 'player_prop' && leg.stat && leg.stat !== 'other' && leg.stat !== 'total_tds') return leg;
    const t = ((leg.raw_text || '') + ' ' + (leg.notes || '')).toLowerCase();
    if (/\bfirst\s+(td|touchdown)/.test(t)) { leg.market = 'first_td'; leg.stat = null; leg.side = 'yes'; leg.line = null; }
    else if (/\blast\s+(td|touchdown)/.test(t)) { leg.market = 'last_td'; leg.stat = null; leg.side = 'yes'; leg.line = null; }
    else if (/\b(anytime|any\s*time)\s+(td|touchdown)|\bto\s+score\s+a\s+(td|touchdown)/.test(t)) {
      if (leg.side === 'under' || /\b(lower|less|under)\b/.test(t)) { leg.market = 'player_prop'; leg.stat = 'total_tds'; leg.side = 'under'; leg.line = 0.5; }
      else { leg.market = 'anytime_td'; leg.stat = null; leg.side = 'yes'; leg.line = null; }
    }
    return leg;
  }