/* Fusion bracket engine: double elimination with byes, bracket reset, placings.
   Shared by the bracket page (browser) and the Netlify functions (server), so both
   agree on who plays whom and which results still count. */
(function (root) {
  var Engine = (function () {
    'use strict';

    function nextPow2(n) { var s = 1; while (s < n) s *= 2; return s; }

    // Standard bracket placement: 1v8, 4v5, 2v7, 3v6 ...
    function seedOrder(S) {
      var order = [1];
      while (order.length < S) {
        var len = order.length * 2, next = [];
        for (var i = 0; i < order.length; i++) next.push(order[i], len + 1 - order[i]);
        order = next;
      }
      return order;
    }

    // Where winners-side losers land in a losers drop round (spreads players apart to avoid early rematches).
    function dropPerm(i, n, d) {
      if (n < 2) return i;
      return d % 2 === 1 ? n - 1 - i : (i + n / 2) % n;
    }

    function roundLabel(side, r, total) {
      var w = side === 'W', s = w ? 'Winners' : 'Losers', c = w ? 'W' : 'L';
      if (r === total) return [s + ' Final', c + 'F'];
      if (r === total - 1) return [s + ' Semi-Final', c + 'SF'];
      if (r === total - 2) return [s + ' Quarter-Final', c + 'QF'];
      return [s + ' Round ' + r, c + 'R' + r];
    }

    // Static double-elimination structure for N entrants.
    function build(N, reset) {
      N = Math.max(0, N | 0);
      var S = Math.max(2, nextPow2(Math.max(N, 2)));
      var k = Math.round(Math.log(S) / Math.LN2);
      var order = seedOrder(S);
      var M = {}, W = [], L = [];
      function add(id, side, round, index, src) { M[id] = { id: id, side: side, round: round, index: index, src: src }; return id; }

      for (var r = 1; r <= k; r++) {
        var cnt = S >> r, col = [];
        for (var i = 0; i < cnt; i++) {
          col.push(add('W' + r + '-' + (i + 1), 'W', r, i, r === 1
            ? [{ seed: order[2 * i] }, { seed: order[2 * i + 1] }]
            : [{ w: 'W' + (r - 1) + '-' + (2 * i + 1) }, { w: 'W' + (r - 1) + '-' + (2 * i + 2) }]));
        }
        W.push(col);
      }

      var LR = k >= 2 ? 2 * (k - 1) : 0;
      if (k >= 2) {
        var lc = [];
        for (var a = 0; a < S / 4; a++) lc.push(add('L1-' + (a + 1), 'L', 1, a, [{ l: 'W1-' + (2 * a + 1) }, { l: 'W1-' + (2 * a + 2) }]));
        L.push(lc);
        for (var j = 1; j <= k - 1; j++) {
          var rd = 2 * j, dc = S >> (j + 1), drop = [];
          for (var b = 0; b < dc; b++) {
            drop.push(add('L' + rd + '-' + (b + 1), 'L', rd, b, [{ w: 'L' + (rd - 1) + '-' + (b + 1) }, { l: 'W' + (j + 1) + '-' + (dropPerm(b, dc, j) + 1) }]));
          }
          L.push(drop);
          if (j < k - 1) {
            var rh = rd + 1, hc = S >> (j + 2), half = [];
            for (var c = 0; c < hc; c++) {
              half.push(add('L' + rh + '-' + (c + 1), 'L', rh, c, [{ w: 'L' + rd + '-' + (2 * c + 1) }, { w: 'L' + rd + '-' + (2 * c + 2) }]));
            }
            L.push(half);
          }
        }
      }

      var lbChamp = k >= 2 ? { w: 'L' + LR + '-1' } : { l: 'W1-1' };
      add('GF1', 'G', 1, 0, [{ w: 'W' + k + '-1' }, lbChamp]);
      if (reset) add('GF2', 'G', 2, 0, [{ w: 'W' + k + '-1' }, lbChamp]);

      // Play order: dependencies always come first.
      var seq = W[0].slice();
      if (k >= 2) seq = seq.concat(L[0]);
      for (var r2 = 2; r2 <= k; r2++) {
        seq = seq.concat(W[r2 - 1]);
        var d2 = 2 * (r2 - 1);
        seq = seq.concat(L[d2 - 1]);
        if (d2 + 1 <= LR) seq = seq.concat(L[d2]);
      }
      seq.push('GF1');
      if (reset) seq.push('GF2');

      function isBye(s) {
        if (s.seed != null) return s.seed > N;
        if (s.w) return M[s.w].bye[0] && M[s.w].bye[1];
        return M[s.l].bye[0] || M[s.l].bye[1];
      }
      var n = 0;
      seq.forEach(function (id) {
        var m = M[id];
        m.bye = m.src.map(isBye);
        m.auto = m.bye[0] || m.bye[1];
        m.num = m.auto ? null : ++n;
        var lab = m.side === 'G'
          ? (m.round === 1 ? ['Grand Final', 'GF'] : ['Grand Final Reset', 'GF2'])
          : roundLabel(m.side, m.round, m.side === 'W' ? k : LR);
        m.name = lab[0];
        m.short = lab[1];
      });

      // Losers of a losers round tie for the same place.
      var lbPlace = {}, gone = 0;
      for (var lr = 1; lr <= LR; lr++) {
        gone += L[lr - 1].filter(function (id) { return !M[id].auto; }).length;
        lbPlace[lr] = N - gone + 1;
      }
      var realTotal = seq.filter(function (id) { return id !== 'GF2' && !M[id].auto; }).length;
      return { N: N, S: S, k: k, LR: LR, order: order, M: M, W: W, L: L, seq: seq, lbPlace: lbPlace, realTotal: realTotal, reset: !!reset };
    }

    function isNum(v) { return typeof v === 'number' && isFinite(v); }

    // Resolve a bracket's live state from its players and recorded results.
    function run(br) {
      var players = (br.players || []).filter(function (p) { return p && p.id; });
      var N = players.length;
      var st = build(N, br.reset !== false);
      var P = {};
      players.forEach(function (p, i) { P[p.id] = { id: p.id, name: p.name, seed: i + 1 }; });
      var R = br.results || {}, LV = br.live || {};
      var out = {}, stale = [];

      function part(s) {
        if (s.seed != null) return s.seed <= N ? { p: players[s.seed - 1].id } : { bye: true };
        var x = out[s.w || s.l];
        return x && x.done ? (s.w ? x.winner : x.loser) : null;
      }

      st.seq.forEach(function (id) {
        var m = st.M[id];
        var o = { id: id, slots: [null, null], done: false, status: 'pending', score: null };
        out[id] = o;
        if (id === 'GF2') {
          var g = out.GF1;
          if (!g.done) { if (R[id]) stale.push(id); return; }
          if (g.winner.p === g.slots[0].p) { o.status = 'skipped'; if (R[id]) stale.push(id); return; }
          o.slots = [g.slots[0], g.slots[1]];
        } else {
          o.slots = m.src.map(part);
        }
        var a = o.slots[0], b = o.slots[1];
        if (!a || !b) { o.status = (a || b) ? 'waiting' : 'pending'; if (R[id]) stale.push(id); return; }
        if (a.bye || b.bye) {
          o.done = true; o.status = 'auto';
          o.winner = a.bye ? b : a; o.loser = a.bye ? a : b;
          return;
        }
        var r = R[id];
        var ok = r && ((r.a === a.p && r.b === b.p) || (r.a === b.p && r.b === a.p)) && (r.w === a.p || r.w === b.p);
        if (ok) {
          o.done = true; o.status = 'done'; o.t = r.t || null;
          var aw = r.w === a.p;
          o.winner = aw ? a : b; o.loser = aw ? b : a;
          var flip = r.a !== a.p, sa = flip ? r.sb : r.sa, sb = flip ? r.sa : r.sb;
          o.score = (isNum(sa) || isNum(sb)) ? [isNum(sa) ? sa : null, isNum(sb) ? sb : null] : null;
        } else {
          if (r) stale.push(id);
          var lv = LV[id];
          o.status = lv ? 'live' : 'ready';
          if (lv) { o.setup = lv.setup || ''; o.liveT = lv.t || null; }
        }
      });

      var staleLive = Object.keys(LV).filter(function (id) { return !out[id] || out[id].status !== 'live'; });
      Object.keys(R).forEach(function (id) { if (!st.M[id] && stale.indexOf(id) < 0) stale.push(id); });

      var champion = null, runnerUp = null, g1 = out.GF1;
      if (g1 && g1.status === 'done') {
        if (g1.winner.p === g1.slots[0].p || !st.M.GF2) { champion = g1.winner.p; runnerUp = g1.loser.p; }
        else if (out.GF2.status === 'done') { champion = out.GF2.winner.p; runnerUp = out.GF2.loser.p; }
      }

      var place = {}, rec = {};
      players.forEach(function (p) { rec[p.id] = { w: 0, l: 0 }; });
      st.seq.forEach(function (id) {
        var o = out[id];
        if (o.status !== 'done') return;
        rec[o.winner.p].w++; rec[o.loser.p].l++;
        var m = st.M[id];
        if (m.side === 'L') place[o.loser.p] = { place: st.lbPlace[m.round], out: m.name };
      });
      if (champion) {
        place[champion] = { place: 1, out: null };
        place[runnerUp] = { place: 2, out: out.GF2 && out.GF2.status === 'done' ? 'Grand Final Reset' : 'Grand Final' };
      }

      var gf2Needed = !!(st.M.GF2 && out.GF1.done && out.GF2.status !== 'skipped');
      var byNum = function (x, y) { return st.M[x].num - st.M[y].num; };
      var live = st.seq.filter(function (id) { return out[id].status === 'live'; }).sort(byNum);
      var ready = st.seq.filter(function (id) { return out[id].status === 'ready'; });
      var recent = st.seq.filter(function (id) { return out[id].status === 'done'; }).sort(function (x, y) {
        return String(out[y].t || '').localeCompare(String(out[x].t || '')) || st.M[y].num - st.M[x].num;
      });
      var done = recent.length;
      return {
        st: st, out: out, players: players, P: P, champion: champion, runnerUp: runnerUp,
        place: place, rec: rec, total: st.realTotal + (gf2Needed ? 1 : 0), done: done,
        live: live, ready: ready, recent: recent, stale: stale, staleLive: staleLive,
        gf2Needed: gf2Needed, complete: !!champion
      };
    }

    // Placeholder text for a slot that isn't filled yet.
    function describe(st, s) {
      if (s.seed != null) return 'Seed ' + s.seed;
      var x = st.M[s.w || s.l];
      if (s.w && x.auto) return describe(st, x.src[x.bye[0] ? 1 : 0]);
      if (x.auto) return 'Bye';
      return (s.w ? 'Winner of #' : 'Loser of #') + x.num;
    }

    // The match a player is in now or plays next (null once they're out or champion).
    function nextFor(D, pid) {
      for (var i = 0; i < D.st.seq.length; i++) {
        var o = D.out[D.st.seq[i]];
        if (o.done || o.status === 'skipped') continue;
        if ((o.slots[0] && o.slots[0].p === pid) || (o.slots[1] && o.slots[1].p === pid)) return o.id;
      }
      return null;
    }

    return { build: build, run: run, describe: describe, nextFor: nextFor, seedOrder: seedOrder };
  })();

  if (typeof module === 'object' && module.exports) module.exports = Engine;
  root.FusionEngine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
