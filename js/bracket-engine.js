/* Fusion bracket engine: every format the site can run (double elimination, single
   elimination, round robin, groups then knockout, Swiss). Shared by the bracket page
   (browser) and the Netlify functions (server), so both agree on who plays whom, which
   results still count, the standings and the placings.

   run({ format, settings, players: [{ id, name }] in seed order,
         results: { matchId: { a, b, w, sa, sb, t } }, live: { matchId: { setup, t } } })
   A result's w is the winner's id, or null for a draw (only where draws are allowed). */
(function (root) {
    "use strict";

    var FORMATS = ["double", "single", "roundrobin", "groups", "swiss"];
    var FORMAT_NAMES = {
        double: "Double elimination",
        single: "Single elimination",
        roundrobin: "Round robin",
        groups: "Groups, then knockout",
        swiss: "Swiss"
    };
    var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    function nextPow2(n) { var s = 1; while (s < n) { s *= 2; } return s; }
    function log2(n) { var k = 0; while ((1 << k) < n) { k++; } return k; }
    function toInt(v, d) { v = parseInt(v, 10); return isFinite(v) ? v : d; }
    function isNum(v) { return typeof v === "number" && isFinite(v); }
    function pairKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
    function count(n, one, many) { return n + " " + (n === 1 ? one : many); }
    function ordinal(n) {
        var s = ["th", "st", "nd", "rd"], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // Standard bracket placement: 1v8, 4v5, 2v7, 3v6 ...
    function seedOrder(S) {
        var order = [1];
        while (order.length < S) {
            var len = order.length * 2, next = [];
            for (var i = 0; i < order.length; i++) { next.push(order[i], len + 1 - order[i]); }
            order = next;
        }
        return order;
    }

    // Where winners-side losers land in a losers drop round (keeps early rematches apart).
    function dropPerm(i, n, d) {
        if (n < 2) { return i; }
        return d % 2 === 1 ? n - 1 - i : (i + n / 2) % n;
    }

    // Seed 1 to group A, 2 to B, ... then back the other way, so the groups come out even.
    function snake(total, g) {
        var groups = [];
        for (var i = 0; i < g; i++) { groups.push([]); }
        for (var s = 0; s < total; s++) {
            var row = Math.floor(s / g), col = s % g;
            groups[row % 2 ? g - 1 - col : col].push(s);
        }
        return groups;
    }

    // Round-robin schedule (circle method): rounds of [i, j] index pairs with i < j.
    // With an odd number of players, one sits out each round.
    function rrRounds(total) {
        var list = [];
        for (var i = 0; i < total; i++) { list.push(i); }
        if (total % 2) { list.push(-1); }
        var n = list.length, rounds = [];
        for (var r = 0; r < n - 1; r++) {
            var pairs = [];
            for (var j = 0; j < n / 2; j++) {
                var a = list[j], b = list[n - 1 - j];
                if (a >= 0 && b >= 0) { pairs.push(a < b ? [a, b] : [b, a]); }
            }
            pairs.sort(function (x, y) { return x[0] - y[0]; });
            rounds.push(pairs);
            list = [list[0], list[n - 1]].concat(list.slice(1, n - 1));
        }
        return rounds;
    }

    // ---------- What a format looks like for a given number of players ----------
    function plan(format, settings, players) {
        var s = settings && typeof settings === "object" ? settings : {};
        var f = FORMAT_NAMES[format] ? format : "double";
        var N = Math.max(0, players | 0);
        var o = { format: f, name: FORMAT_NAMES[f], N: N, problems: [] };
        if (f === "double") {
            o.reset = s.reset !== false;
            o.matches = Math.max(0, 2 * N - 2);
        } else if (f === "single") {
            o.third = !!s.third;
            o.matches = Math.max(0, N - 1) + (o.third && N >= 4 ? 1 : 0);
        } else if (f === "roundrobin") {
            o.draws = !!s.draws;
            o.rounds = N < 2 ? 0 : (N % 2 ? N : N - 1);
            o.matches = N * (N - 1) / 2;
        } else if (f === "swiss") {
            o.draws = !!s.draws;
            o.maxRounds = N < 2 ? 1 : (N % 2 ? N : N - 1);
            o.autoRounds = N < 2 ? 1 : Math.max(1, log2(N));
            o.roundsSet = toInt(s.rounds, 0) > 0 ? Math.min(toInt(s.rounds, 0), 99) : null;
            o.rounds = Math.min(o.roundsSet || o.autoRounds, o.maxRounds);
            if (o.roundsSet && o.roundsSet > o.maxRounds && N >= 2) {
                o.problems.push(N + " players can play " + count(o.maxRounds, "Swiss round", "Swiss rounds") + " at most without a rematch.");
            }
            o.matches = o.rounds * Math.floor(N / 2);
        } else {
            o.draws = !!s.draws;
            o.ko = s.ko === "double" ? "double" : "single";
            o.reset = s.reset !== false;
            o.third = !!s.third;
            o.autoGroups = Math.max(1, Math.round(N / 4));
            o.groupsSet = toInt(s.groups, 0) > 0 ? Math.min(toInt(s.groups, 0), 26) : null;
            o.maxGroups = Math.max(1, Math.floor(N / 2));
            var G = o.groupsSet || o.autoGroups;
            if (G > o.maxGroups) {
                if (o.groupsSet && N >= 2) {
                    o.problems.push("Each group needs at least 2 players, so " + N + " players fit in " + count(o.maxGroups, "group", "groups") + " at most.");
                }
                G = o.maxGroups;
            }
            o.groups = G;
            o.members = snake(N, G);
            o.minSize = Math.floor(N / G);
            o.maxSize = Math.ceil(N / G);
            o.advanceSet = Math.max(1, Math.min(toInt(s.advance, 2), 8));
            o.advance = Math.max(1, Math.min(o.advanceSet, o.minSize || 1));
            if (o.advanceSet > o.minSize && N >= 2) {
                o.problems.push("The smallest group has " + o.minSize + " players, so at most " + o.minSize + " can go through from each group.");
            }
            o.qualifiers = G * o.advance;
            if (o.qualifiers < 2 && N >= 2) {
                o.problems.push("At least 2 players have to reach the knockout. Add a group or let more players through.");
            }
            var gm = 0;
            o.members.forEach(function (m) { gm += m.length * (m.length - 1) / 2; });
            var Q = o.qualifiers;
            o.groupMatches = gm;
            o.koMatches = Q < 2 ? 0 : (o.ko === "double" ? 2 * Q - 2 : Q - 1 + (o.third && Q >= 4 ? 1 : 0));
            o.matches = gm + o.koMatches;
        }
        if (N < 2) { o.problems.unshift("A bracket needs at least 2 players."); }
        o.summary = describePlan(o);
        return o;
    }

    function describePlan(o) {
        var N = o.N, f = o.format, enough = N >= 2;
        var drawsText = o.draws ? " · draws allowed" : "";
        if (f === "double") {
            return "Two losses and you’re out" + (enough ? " · " + count(o.matches, "match", "matches") + (o.reset ? ", plus a bracket reset if it’s needed" : "") : "");
        }
        if (f === "single") {
            return "One loss and you’re out" + (enough ? " · " + count(o.matches, "match", "matches") + (o.third && N >= 4 ? " including a third-place match" : "") : "");
        }
        if (f === "roundrobin") {
            return "Everyone plays everyone" + (enough ? " · " + count(o.matches, "match", "matches") + " over " + count(o.rounds, "round", "rounds") : "") + drawsText;
        }
        if (f === "swiss") {
            return count(o.rounds, "round", "rounds") + ", paired by record" + (enough ? " · " + count(o.matches, "match", "matches") + (N % 2 ? " · one bye each round" : "") : "") + drawsText;
        }
        if (!enough) {
            return "Round-robin groups, then a knockout bracket" + drawsText;
        }
        var size = o.minSize === o.maxSize ? String(o.minSize) : o.minSize + "–" + o.maxSize;
        var an = o.qualifiers === 11 || o.qualifiers === 18 || String(o.qualifiers).charAt(0) === "8";
        return (o.groups === 1 ? "One group of " + N : o.groups + " groups of " + size) +
            " · top " + o.advance + " from each go through to " + (an ? "an " : "a ") + o.qualifiers + "-player " + o.ko + "-elimination bracket · " +
            count(o.matches, "match", "matches") + drawsText;
    }

    // ---------- Elimination brackets ----------
    function roundName(side, r, total) {
        var pre = side === "W" ? "Winners " : side === "L" ? "Losers " : "";
        var c = side === "W" || side === "L" ? side : "";
        if (r === total) { return [pre + "Final", c + "F"]; }
        if (r === total - 1) { return [pre + "Semi-Final", c + "SF"]; }
        if (r === total - 2) { return [pre + "Quarter-Final", c + "QF"]; }
        return [pre + "Round " + r, c + "R" + r];
    }

    // Structure of an elimination bracket for n entrants. double: losers side and grand
    // final (reset optional); single: one bracket with an optional third-place match.
    function elim(n, opt) {
        var dbl = !!opt.double;
        var S = Math.max(2, nextPow2(Math.max(n, 2)));
        var k = log2(S);
        var order = seedOrder(S);
        var M = {}, W = [], L = [];
        function add(id, side, round, src) {
            M[id] = { id: id, stage: "ko", side: side, round: round, src: src, draws: false };
            return id;
        }
        for (var r = 1; r <= k; r++) {
            var col = [], cnt = S >> r;
            for (var i = 0; i < cnt; i++) {
                col.push(add("W" + r + "-" + (i + 1), "W", r, r === 1
                    ? [{ seed: order[2 * i] }, { seed: order[2 * i + 1] }]
                    : [{ w: "W" + (r - 1) + "-" + (2 * i + 1) }, { w: "W" + (r - 1) + "-" + (2 * i + 2) }]));
            }
            W.push(col);
        }

        var LR = dbl && k >= 2 ? 2 * (k - 1) : 0;
        if (LR) {
            var lc = [];
            for (var a = 0; a < S / 4; a++) {
                lc.push(add("L1-" + (a + 1), "L", 1, [{ l: "W1-" + (2 * a + 1) }, { l: "W1-" + (2 * a + 2) }]));
            }
            L.push(lc);
            for (var j = 1; j <= k - 1; j++) {
                var rd = 2 * j, dc = S >> (j + 1), drop = [];
                for (var b = 0; b < dc; b++) {
                    drop.push(add("L" + rd + "-" + (b + 1), "L", rd, [{ w: "L" + (rd - 1) + "-" + (b + 1) }, { l: "W" + (j + 1) + "-" + (dropPerm(b, dc, j) + 1) }]));
                }
                L.push(drop);
                if (j < k - 1) {
                    var rh = rd + 1, hc = S >> (j + 2), half = [];
                    for (var c = 0; c < hc; c++) {
                        half.push(add("L" + rh + "-" + (c + 1), "L", rh, [{ w: "L" + rd + "-" + (2 * c + 1) }, { w: "L" + rd + "-" + (2 * c + 2) }]));
                    }
                    L.push(half);
                }
            }
        }

        var gf = [], third = null, final;
        if (dbl) {
            var lbChamp = k >= 2 ? { w: "L" + LR + "-1" } : { l: "W1-1" };
            gf.push(add("GF1", "G", 1, [{ w: "W" + k + "-1" }, lbChamp]));
            if (opt.reset) { gf.push(add("GF2", "G", 2, [{ w: "W" + k + "-1" }, lbChamp])); }
            final = "GF1";
        } else {
            final = "W" + k + "-1";
            if (opt.third && k >= 2) {
                third = add("P3", "P", 1, [{ l: "W" + (k - 1) + "-1" }, { l: "W" + (k - 1) + "-2" }]);
            }
        }

        // Play order: a match always comes after the matches it depends on.
        var seq = W[0].slice();
        if (dbl) {
            if (k >= 2) { seq = seq.concat(L[0]); }
            for (var r2 = 2; r2 <= k; r2++) {
                seq = seq.concat(W[r2 - 1]);
                var d2 = 2 * (r2 - 1);
                seq = seq.concat(L[d2 - 1]);
                if (d2 + 1 <= LR) { seq = seq.concat(L[d2]); }
            }
            seq = seq.concat(gf);
        } else {
            for (var r3 = 2; r3 < k; r3++) { seq = seq.concat(W[r3 - 1]); }
            if (k >= 2) {
                if (third) { seq.push(third); }
                seq = seq.concat(W[k - 1]);
            }
        }

        function isBye(s) {
            if (s.seed != null) { return s.seed > n; }
            if (s.w) { return M[s.w].bye[0] && M[s.w].bye[1]; }
            return M[s.l].bye[0] || M[s.l].bye[1];
        }
        seq.forEach(function (id) {
            var m = M[id];
            m.bye = m.src.map(isBye);
            m.auto = m.bye[0] || m.bye[1];
            var lab = m.side === "G" ? (m.round === 1 ? ["Grand Final", "GF"] : ["Grand Final Reset", "GF2"])
                : m.side === "P" ? ["Third-place match", "3rd"]
                : roundName(dbl ? m.side : "K", m.round, m.side === "L" ? LR : k);
            m.name = lab[0];
            m.short = lab[1];
        });

        // Losers of a losers-side round tie for the same place.
        var lbPlace = {}, gone = 0;
        for (var lr = 1; lr <= LR; lr++) {
            gone += L[lr - 1].filter(function (id) { return !M[id].auto; }).length;
            lbPlace[lr] = n - gone + 1;
        }
        return { n: n, S: S, k: k, LR: LR, double: dbl, M: M, W: W, L: L, gf: gf, final: final, third: third, seq: seq, lbPlace: lbPlace, labels: null };
    }

    // ---------- Shared match resolution ----------
    function blank(id) {
        return { id: id, slots: [null, null], done: false, status: "pending", score: null, draw: false, winner: null, loser: null };
    }

    function add(ctx, m) {
        ctx.M[m.id] = m;
        ctx.seq.push(m.id);
    }

    // Works out a match's status from its two players and any recorded result.
    function settle(ctx, o, m) {
        var a = o.slots[0], b = o.slots[1], r = ctx.R[o.id];
        if (!a || !b) {
            o.status = (a || b) ? "waiting" : "pending";
            if (r) { ctx.stale.push(o.id); }
            return;
        }
        if (a.bye || b.bye) {
            o.done = true;
            o.status = "auto";
            o.winner = a.bye ? b : a;
            o.loser = a.bye ? a : b;
            if (r) { ctx.stale.push(o.id); }
            return;
        }
        var pa = a.p, pb = b.p;
        var same = !!r && ((r.a === pa && r.b === pb) || (r.a === pb && r.b === pa));
        var draw = same && r.w == null && !!m.draws;
        if (same && (r.w === pa || r.w === pb || draw)) {
            o.done = true;
            o.status = "done";
            o.t = r.t || null;
            if (draw) {
                o.draw = true;
            } else {
                var aw = r.w === pa;
                o.winner = aw ? a : b;
                o.loser = aw ? b : a;
            }
            var flip = r.a !== pa, sa = flip ? r.sb : r.sa, sb = flip ? r.sa : r.sb;
            o.score = (isNum(sa) || isNum(sb)) ? [isNum(sa) ? sa : null, isNum(sb) ? sb : null] : null;
        } else {
            if (r) { ctx.stale.push(o.id); }
            var lv = ctx.LV[o.id];
            o.status = lv ? "live" : "ready";
            if (lv) {
                o.setup = lv.setup || "";
                o.liveT = lv.t || null;
            }
        }
    }

    function resolveElim(ctx, el, entrant) {
        var out = ctx.out, M = ctx.M;
        function part(s) {
            if (s.seed != null) { return s.seed > el.n ? { bye: true } : entrant(s.seed); }
            var x = out[s.w || s.l];
            return x && x.done ? (s.w ? x.winner : x.loser) : null;
        }
        el.seq.forEach(function (id) {
            var m = M[id], o = blank(id);
            out[id] = o;
            if (id === "GF2") {
                var g = out.GF1;
                if (!g.done) {
                    if (ctx.R[id]) { ctx.stale.push(id); }
                    return;
                }
                if (g.winner.p === g.slots[0].p) {
                    o.status = "skipped";
                    if (ctx.R[id]) { ctx.stale.push(id); }
                    return;
                }
                o.slots = [g.slots[0], g.slots[1]];
            } else {
                o.slots = m.src.map(part);
            }
            settle(ctx, o, m);
        });
        ctx.gf2Needed = !!(M.GF2 && out.GF1.done && out.GF2.status !== "skipped");
    }

    // Champion, runner-up and the places of everyone knocked out so far.
    function elimPlaces(ctx, el) {
        var out = ctx.out, M = ctx.M, place = {}, champion = null, runnerUp = null;
        if (el.double) {
            var g1 = out.GF1;
            if (g1 && g1.status === "done") {
                if (g1.winner.p === g1.slots[0].p || !M.GF2) {
                    champion = g1.winner.p;
                    runnerUp = g1.loser.p;
                } else if (out.GF2.status === "done") {
                    champion = out.GF2.winner.p;
                    runnerUp = out.GF2.loser.p;
                }
            }
            el.seq.forEach(function (id) {
                var o = out[id], m = M[id];
                if (o.status === "done" && m.side === "L") { place[o.loser.p] = { place: el.lbPlace[m.round], out: m.name }; }
            });
            if (champion) {
                place[champion] = { place: 1, out: null };
                place[runnerUp] = { place: 2, out: out.GF2 && out.GF2.status === "done" ? "Grand Final Reset" : "Grand Final" };
            }
        } else {
            el.seq.forEach(function (id) {
                var o = out[id], m = M[id];
                if (o.status !== "done" || m.side !== "W" || id === el.final) { return; }
                if (el.third && m.round === el.k - 1) { return; } // semi-final losers play for third
                place[o.loser.p] = { place: el.S / Math.pow(2, m.round) + 1, out: m.name };
            });
            if (el.third) {
                var t = out[el.third];
                if (t.status === "done") {
                    place[t.winner.p] = { place: 3, out: "Third-place match" };
                    place[t.loser.p] = { place: 4, out: "Third-place match" };
                } else if (t.status === "auto" && t.winner && t.winner.p) {
                    place[t.winner.p] = { place: 3, out: "Semi-Final" };
                }
            }
            var f = out[el.final];
            if (f && f.status === "done") {
                champion = f.winner.p;
                runnerUp = f.loser.p;
                place[champion] = { place: 1, out: null };
                place[runnerUp] = { place: 2, out: "Final" };
            }
        }
        return { place: place, champion: champion, runnerUp: runnerUp };
    }

    // ---------- League tables ----------
    // mode "league": points, then head-to-head among players level on points, then score
    // difference, scores for, seed. mode "swiss": points, then opponents' points
    // (Buchholz), then score difference, scores for, seed. A win is 3 points, a draw 1.
    function standings(ctx, pids, ids, mode, byes) {
        var rows = {}, list = [];
        pids.forEach(function (p) {
            rows[p] = { p: p, seed: ctx.P[p].seed, played: 0, w: 0, d: 0, l: 0, pts: 0, sf: 0, sa: 0, diff: 0, byes: 0, opp: [], buch: 0, h2h: 0, rank: 0 };
            list.push(rows[p]);
        });
        ids.forEach(function (id) {
            var o = ctx.out[id];
            if (o.status !== "done") { return; }
            var a = rows[o.slots[0].p], b = rows[o.slots[1].p];
            if (!a || !b) { return; }
            a.played++;
            b.played++;
            a.opp.push(b.p);
            b.opp.push(a.p);
            if (o.draw) {
                a.d++;
                b.d++;
                a.pts += 1;
                b.pts += 1;
            } else {
                rows[o.winner.p].w++;
                rows[o.winner.p].pts += 3;
                rows[o.loser.p].l++;
            }
            if (o.score && o.score[0] != null && o.score[1] != null) {
                a.sf += o.score[0];
                a.sa += o.score[1];
                b.sf += o.score[1];
                b.sa += o.score[0];
            }
        });
        if (byes) {
            Object.keys(byes).forEach(function (p) {
                var r = rows[p];
                if (r) {
                    r.byes += byes[p];
                    r.w += byes[p];
                    r.pts += 3 * byes[p];
                }
            });
        }
        list.forEach(function (r) { r.diff = r.sf - r.sa; });
        if (mode === "swiss") {
            list.forEach(function (r) { r.buch = r.opp.reduce(function (sum, q) { return sum + rows[q].pts; }, 0); });
        }
        var rest = mode === "swiss"
            ? function (x, y) { return y.buch - x.buch || y.diff - x.diff || y.sf - x.sf || x.seed - y.seed; }
            : function (x, y) { return y.diff - x.diff || y.sf - x.sf || x.seed - y.seed; };
        list.sort(function (x, y) { return y.pts - x.pts || rest(x, y); });
        if (mode !== "swiss") {
            var i = 0;
            while (i < list.length) {
                var j = i;
                while (j + 1 < list.length && list[j + 1].pts === list[i].pts) { j++; }
                if (j > i) {
                    var tied = list.slice(i, j + 1), set = {};
                    tied.forEach(function (r) { set[r.p] = 1; r.h2h = 0; });
                    ids.forEach(function (id) {
                        var o = ctx.out[id];
                        if (o.status !== "done" || !set[o.slots[0].p] || !set[o.slots[1].p]) { return; }
                        if (o.draw) {
                            rows[o.slots[0].p].h2h++;
                            rows[o.slots[1].p].h2h++;
                        } else {
                            rows[o.winner.p].h2h += 3;
                        }
                    });
                    tied.sort(function (x, y) { return y.h2h - x.h2h || rest(x, y); });
                    for (var t = 0; t < tied.length; t++) { list[i + t] = tied[t]; }
                }
                i = j + 1;
            }
        }
        list.forEach(function (r, n) { r.rank = n + 1; });
        return list;
    }

    function leagueFinish(ctx, ids) {
        ctx.place = {};
        var complete = ctx.N >= 2 && ids.every(function (id) { return ctx.out[id].done; });
        if (!complete) { return; }
        ctx.table.forEach(function (row) { ctx.place[row.p] = { place: row.rank, out: null }; });
        ctx.champion = ctx.table[0].p;
        ctx.runnerUp = ctx.table[1].p;
    }

    // ---------- Formats ----------
    function runElim(ctx) {
        var pl = ctx.plan;
        var el = elim(ctx.N, { double: pl.format === "double", reset: pl.reset, third: pl.third });
        el.seq.forEach(function (id) { add(ctx, el.M[id]); });
        ctx.el = el;
        resolveElim(ctx, el, function (k) { return { p: ctx.players[k - 1].id }; });
        var res = elimPlaces(ctx, el);
        ctx.place = res.place;
        ctx.champion = res.champion;
        ctx.runnerUp = res.runnerUp;
    }

    function runRoundRobin(ctx) {
        var pl = ctx.plan, ids = [];
        ctx.rounds = rrRounds(ctx.N).map(function (pairs, r) {
            var round = { n: r + 1, name: "Round " + (r + 1), ids: [], rest: null, paired: true };
            var seen = {};
            pairs.forEach(function (pr, i) {
                var id = "r" + (r + 1) + "-" + (i + 1);
                var m = { id: id, stage: "rr", round: r + 1, name: "Round " + (r + 1), short: "R" + (r + 1), draws: pl.draws };
                add(ctx, m);
                var o = blank(id);
                ctx.out[id] = o;
                o.slots = [{ p: ctx.players[pr[0]].id }, { p: ctx.players[pr[1]].id }];
                settle(ctx, o, m);
                round.ids.push(id);
                ids.push(id);
                seen[pr[0]] = 1;
                seen[pr[1]] = 1;
            });
            if (ctx.N % 2) {
                for (var i = 0; i < ctx.N; i++) {
                    if (!seen[i]) {
                        round.rest = ctx.players[i].id;
                        break;
                    }
                }
            }
            return round;
        });
        ctx.table = standings(ctx, ctx.players.map(function (p) { return p.id; }), ids, "league");
        leagueFinish(ctx, ids);
    }

    function points(ctx, ids, byes) {
        var pts = {};
        ctx.players.forEach(function (p) { pts[p.id] = 3 * (byes[p.id] || 0); });
        ids.forEach(function (id) {
            var o = ctx.out[id];
            if (o.status !== "done") { return; }
            if (o.draw) {
                pts[o.slots[0].p] += 1;
                pts[o.slots[1].p] += 1;
            } else {
                pts[o.winner.p] += 3;
            }
        });
        return pts;
    }

    // Round 1: top half against bottom half (1 v 5, 2 v 6, ... with 8 players).
    function fold(list) {
        var half = list.length / 2, pairs = [];
        for (var i = 0; i < half; i++) { pairs.push([list[i], list[i + half]]); }
        return pairs;
    }

    // Later rounds: pair down the standings (1 v 2, 3 v 4, ...), skipping anyone you've
    // already played. If no rematch-free pairing exists, rematches are allowed.
    function pairSwiss(list, played) {
        var steps = 0, LIMIT = 40000;
        function go(rest) {
            if (!rest.length) { return []; }
            if (++steps > LIMIT) { return null; }
            var a = rest[0];
            for (var j = 1; j < rest.length; j++) {
                var b = rest[j];
                if (played[pairKey(a, b)]) { continue; }
                var sub = go(rest.slice(1, j).concat(rest.slice(j + 1)));
                if (sub) { return [[a, b]].concat(sub); }
                if (steps > LIMIT) { return null; }
            }
            return null;
        }
        var found = go(list);
        if (found) { return found; }
        var pairs = [];
        for (var i = 0; i + 1 < list.length; i += 2) { pairs.push([list[i], list[i + 1]]); }
        return pairs;
    }

    function runSwiss(ctx) {
        var pl = ctx.plan, N = ctx.N, per = Math.floor(N / 2);
        var ids = [], played = {}, byes = {}, open = N >= 2;
        ctx.rounds = [];
        for (var r = 1; r <= pl.rounds; r++) {
            var round = { n: r, name: "Round " + r, ids: [], bye: null, paired: false };
            var pairs = null;
            if (open) {
                var pts = points(ctx, ids, byes);
                var order = ctx.players.map(function (p) { return p.id; }).sort(function (x, y) {
                    return pts[y] - pts[x] || ctx.P[x].seed - ctx.P[y].seed;
                });
                if (order.length % 2) {
                    var bi = order.length - 1;
                    for (var j = order.length - 1; j >= 0; j--) {
                        if (!byes[order[j]]) {
                            bi = j;
                            break;
                        }
                    }
                    round.bye = order.splice(bi, 1)[0];
                }
                pairs = r === 1 ? fold(order) : pairSwiss(order, played);
                round.paired = true;
            }
            for (var i = 0; i < per; i++) {
                var id = "s" + r + "-" + (i + 1);
                var m = { id: id, stage: "swiss", round: r, name: "Round " + r, short: "R" + r, draws: pl.draws };
                add(ctx, m);
                var o = blank(id);
                ctx.out[id] = o;
                if (pairs) {
                    o.slots = [{ p: pairs[i][0] }, { p: pairs[i][1] }];
                    settle(ctx, o, m);
                    played[pairKey(pairs[i][0], pairs[i][1])] = true;
                } else if (ctx.R[id]) {
                    ctx.stale.push(id);
                }
                round.ids.push(id);
                ids.push(id);
            }
            if (round.bye) { byes[round.bye] = (byes[round.bye] || 0) + 1; }
            ctx.rounds.push(round);
            open = open && round.ids.every(function (x) { return ctx.out[x].done; });
        }
        ctx.byes = byes;
        ctx.table = standings(ctx, ctx.players.map(function (p) { return p.id; }), ids, "swiss", byes);
        leagueFinish(ctx, ids);
    }

    // Moves knockout entrants around (within the same group position) so nobody meets
    // someone from their own group in the first round, where that can be avoided.
    function spreadGroups(ent) {
        var n = ent.length;
        var S = nextPow2(Math.max(n, 2)), order = seedOrder(S), pairs = [];
        for (var i = 0; i < S; i += 2) {
            if (order[i] <= n && order[i + 1] <= n) { pairs.push([order[i] - 1, order[i + 1] - 1]); }
        }
        function clash(pr) { return ent[pr[0]].g === ent[pr[1]].g; }
        for (var pass = 0; pass < 3; pass++) {
            var changed = false;
            pairs.forEach(function (p1) {
                if (!clash(p1)) { return; }
                for (var j = 0; j < pairs.length; j++) {
                    var p2 = pairs[j], x = p1[1], y = p2[1];
                    if (p2 === p1 || ent[x].pos !== ent[y].pos) { continue; }
                    if (ent[p1[0]].g !== ent[y].g && ent[p2[0]].g !== ent[x].g) {
                        var t = ent[x];
                        ent[x] = ent[y];
                        ent[y] = t;
                        changed = true;
                        return;
                    }
                }
            });
            if (!changed) { break; }
        }
        return ent;
    }

    function runGroups(ctx) {
        var pl = ctx.plan, A = pl.advance;
        var sched = pl.members.map(function (mem) { return rrRounds(mem.length); });
        ctx.groups = pl.members.map(function (mem, g) {
            return {
                key: LETTERS[g], name: "Group " + LETTERS[g],
                players: mem.map(function (i) { return ctx.players[i].id; }),
                ids: [], table: [], done: false
            };
        });
        var maxR = 0;
        sched.forEach(function (s) { maxR = Math.max(maxR, s.length); });
        for (var r = 0; r < maxR; r++) {
            ctx.groups.forEach(function (grp, g) {
                (sched[g][r] || []).forEach(function (pr, i) {
                    var id = "g" + grp.key + (r + 1) + "-" + (i + 1);
                    var m = { id: id, stage: "group", group: grp.key, round: r + 1, name: grp.name + " · Round " + (r + 1), short: grp.key + (r + 1), draws: pl.draws };
                    add(ctx, m);
                    var o = blank(id);
                    ctx.out[id] = o;
                    o.slots = [{ p: grp.players[pr[0]] }, { p: grp.players[pr[1]] }];
                    settle(ctx, o, m);
                    grp.ids.push(id);
                });
            });
        }
        ctx.groups.forEach(function (grp) {
            grp.table = standings(ctx, grp.players, grp.ids, "league");
            grp.done = grp.players.length > 0 && grp.ids.every(function (id) { return ctx.out[id].done; });
        });
        ctx.stage = ctx.groups.every(function (grp) { return grp.done; }) ? "knockout" : "groups";
        ctx.place = {};

        var Q = pl.qualifiers;
        if (Q >= 2) {
            var entrants = [];
            for (var pos = 1; pos <= A; pos++) {
                for (var g = 0; g < ctx.groups.length; g++) { entrants.push({ g: g, pos: pos }); }
            }
            spreadGroups(entrants);
            var el = elim(Q, { double: pl.ko === "double", reset: pl.reset, third: pl.third });
            el.labels = entrants.map(function (e) { return ctx.groups[e.g].name + " · " + ordinal(e.pos); });
            el.entrants = entrants;
            el.seq.forEach(function (id) { add(ctx, el.M[id]); });
            ctx.el = el;
            resolveElim(ctx, el, function (k) {
                var e = entrants[k - 1], grp = ctx.groups[e.g];
                return grp.done ? { p: grp.table[e.pos - 1].p } : null;
            });
            var res = elimPlaces(ctx, el);
            ctx.place = res.place;
            ctx.champion = res.champion;
            ctx.runnerUp = res.runnerUp;
        }

        // Players knocked out in the groups share a place with everyone who finished in
        // the same position of their group.
        var tierStart = {}, next = Q + 1;
        for (var t = A + 1; t <= pl.maxSize; t++) {
            tierStart[t] = next;
            ctx.groups.forEach(function (grp) { if (grp.players.length >= t) { next++; } });
        }
        ctx.groups.forEach(function (grp) {
            if (!grp.done) { return; }
            grp.table.forEach(function (row) {
                if (row.rank > A) { ctx.place[row.p] = { place: tierStart[row.rank], out: "Group stage" }; }
            });
        });
    }

    // ---------- Putting it together ----------
    function finish(ctx) {
        var M = ctx.M, out = ctx.out, n = 0;
        ctx.seq.forEach(function (id) {
            var m = M[id];
            m.num = m.auto ? null : ++n;
        });
        Object.keys(ctx.R).forEach(function (id) {
            if (!M[id] && ctx.stale.indexOf(id) < 0) { ctx.stale.push(id); }
        });
        var staleLive = Object.keys(ctx.LV).filter(function (id) { return !out[id] || out[id].status !== "live"; });
        var rec = {};
        ctx.players.forEach(function (p) { rec[p.id] = { w: ctx.byes[p.id] || 0, d: 0, l: 0 }; });
        var counted = 0, live = [], ready = [], done = [];
        ctx.seq.forEach(function (id) {
            var o = out[id], m = M[id];
            if (!m.auto && o.status !== "skipped" && !(id === "GF2" && !ctx.gf2Needed)) { counted++; }
            if (o.status === "done") {
                done.push(id);
                if (o.draw) {
                    rec[o.slots[0].p].d++;
                    rec[o.slots[1].p].d++;
                } else {
                    rec[o.winner.p].w++;
                    rec[o.loser.p].l++;
                }
            } else if (o.status === "live") {
                live.push(id);
            } else if (o.status === "ready") {
                ready.push(id);
            }
        });
        live.sort(function (x, y) { return M[x].num - M[y].num; });
        var busy = {};
        live.forEach(function (id) {
            busy[out[id].slots[0].p] = 1;
            busy[out[id].slots[1].p] = 1;
        });
        var next = ready.filter(function (id) { return !busy[out[id].slots[0].p] && !busy[out[id].slots[1].p]; });
        var recent = done.slice().sort(function (x, y) {
            return String(out[y].t || "").localeCompare(String(out[x].t || "")) || M[y].num - M[x].num;
        });
        return {
            format: ctx.format, plan: ctx.plan, players: ctx.players, P: ctx.P, M: M, seq: ctx.seq, out: out,
            el: ctx.el, rounds: ctx.rounds, table: ctx.table, groups: ctx.groups, stage: ctx.stage || null, byes: ctx.byes,
            champion: ctx.champion || null, runnerUp: ctx.runnerUp || null,
            // Over once there's a champion and nothing is left to play (a third-place
            // match can still be on after the final).
            complete: !!ctx.champion && done.length >= counted,
            place: ctx.place || {}, rec: rec, total: counted, done: done.length,
            live: live, ready: ready, next: next, recent: recent,
            stale: ctx.stale, staleLive: staleLive, gf2Needed: !!ctx.gf2Needed
        };
    }

    function run(b) {
        b = b || {};
        var players = (b.players || []).filter(function (p) { return p && p.id; });
        var pl = plan(b.format, b.settings, players.length);
        var P = {};
        players.forEach(function (p, i) { P[p.id] = { id: p.id, name: p.name, seed: i + 1 }; });
        var ctx = {
            format: pl.format, plan: pl, players: players, N: players.length, P: P,
            R: b.results || {}, LV: b.live || {}, M: {}, seq: [], out: {}, stale: [],
            el: null, rounds: null, table: null, groups: null, byes: {}, place: {}
        };
        if (pl.format === "double" || pl.format === "single") {
            runElim(ctx);
        } else if (pl.format === "roundrobin") {
            runRoundRobin(ctx);
        } else if (pl.format === "swiss") {
            runSwiss(ctx);
        } else {
            runGroups(ctx);
        }
        return finish(ctx);
    }

    // Text for a slot that has no player yet.
    function describeSrc(D, s) {
        if (s.seed != null) { return D.el && D.el.labels ? D.el.labels[s.seed - 1] : "Seed " + s.seed; }
        var x = D.M[s.w || s.l];
        if (s.w && x.auto) { return describeSrc(D, x.src[x.bye[0] ? 1 : 0]); }
        if (x.auto) { return "Bye"; }
        return (s.w ? "Winner of #" : "Loser of #") + x.num;
    }
    function slotLabel(D, id, i) {
        var m = D.M[id], o = D.out[id];
        if (id === "GF2") { return o.status === "skipped" ? "" : (i ? "Losers finalist" : "Winners finalist"); }
        if (m.stage === "swiss") { return "Paired after round " + (m.round - 1); }
        return m.src && m.src[i] ? describeSrc(D, m.src[i]) : "TBD";
    }

    // The match a player is in now or plays next (null once they're done or waiting).
    function nextFor(D, pid) {
        for (var i = 0; i < D.seq.length; i++) {
            var o = D.out[D.seq[i]];
            if (o.done || o.status === "skipped") { continue; }
            if ((o.slots[0] && o.slots[0].p === pid) || (o.slots[1] && o.slots[1].p === pid)) { return o.id; }
        }
        return null;
    }

    var Engine = {
        FORMATS: FORMATS, FORMAT_NAMES: FORMAT_NAMES,
        plan: plan, run: run, slotLabel: slotLabel, nextFor: nextFor, ordinal: ordinal, seedOrder: seedOrder
    };
    if (typeof module === "object" && module.exports) { module.exports = Engine; }
    root.FusionEngine = Engine;
})(typeof globalThis !== "undefined" ? globalThis : this);
