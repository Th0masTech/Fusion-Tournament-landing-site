/* Fusion bracket page.
   Everyone sees the live brackets from /api/state, checked every few seconds.
   Organizers sign in with the shared password to manage sign-ups, start a bracket and
   report results; every change goes through /api/admin/op and shows up on all screens. */
(function () {
    "use strict";

    var Engine = window.FusionEngine;
    var app = document.getElementById("fx-app");
    if (!Engine || !app) {
        return;
    }

    var POLL_MS = 4000;
    var ZOOMS = [0.5, 0.65, 0.8, 1, 1.2];
    var ICON = {
        crown: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2.5 7.5 7.2 11 12 4l4.8 7 4.7-3.5L19.6 19H4.4z"/></svg>',
        tv: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        shuffle: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M3 17h3.5c1.3 0 2.3-.4 3.1-1.2M14.4 8.2c.8-.8 1.8-1.2 3.1-1.2H21M18 4l3 3-3 3M18 14l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        warn: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4M12 17v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        call: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        lock: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
    };

    // ---------- Helpers ----------
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function obj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
    function toNum(v) { if (v === "" || v == null) { return null; } var n = parseInt(v, 10); return isFinite(n) ? n : null; }
    function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
    function ago(iso) {
        if (!iso) { return ""; }
        var d = (Date.now() - new Date(iso).getTime()) / 1000;
        if (!isFinite(d)) { return ""; }
        if (d < 10) { return "just now"; }
        if (d < 60) { return Math.round(d) + " s ago"; }
        if (d < 3600) { return Math.round(d / 60) + " min ago"; }
        if (d < 86400) { return Math.round(d / 3600) + " h ago"; }
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    function clock() { return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
    function lenCls(name) { var n = String(name).length; return n > 20 ? " n-l" : n > 14 ? " n-m" : ""; }
    function lget(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function ldel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    // ---------- State from the server ----------
    var STATE = null;
    var DCACHE = {};
    var PLAYERS = null;

    function fromApi(s) {
        return {
            rev: +s.rev || 0,
            updatedAt: s.updatedAt || null,
            brackets: (s.brackets || []).map(function (b) {
                return {
                    id: b.game, name: b.name, status: b.status, reset: b.reset !== false, startedAt: b.startedAt,
                    players: (b.players || []).map(function (p) { return { id: p.id, name: p.tag }; }),
                    results: obj(b.results), live: obj(b.live)
                };
            })
        };
    }
    function byId(g) {
        for (var i = 0; i < STATE.brackets.length; i++) { if (STATE.brackets[i].id === g) { return STATE.brackets[i]; } }
        return STATE.brackets[0];
    }
    function cur() { return byId(ui.game); }
    function derive(b) {
        var key = JSON.stringify([b.players, b.results, b.live, b.reset]);
        var c = DCACHE[b.id];
        if (c && c.key === key) { return c.D; }
        var D = Engine.run(b);
        DCACHE[b.id] = { key: key, D: D };
        return D;
    }
    function gc(b) { return b.id === "fc" ? "var(--cyan)" : "var(--pink)"; }

    // ---------- Per-viewer state ----------
    var prefs = obj(lget("fusion.bracket", {}));
    var ui = {
        game: prefs.game || "smash", view: prefs.view || "bracket", zoom: +prefs.zoom || 0,
        follow: obj(prefs.follow), spectate: !!prefs.spectate,
        key: lget("fusion.key", null), to: false, busy: false, offline: false, loadError: null,
        big: false, modal: null, signin: null, confirm: null, flash: {}, settingsOpen: {}, removedOpen: {}
    };
    var hash = (location.hash || "").replace("#", "").toLowerCase();
    if (hash === "big") { ui.big = true; } else if (hash === "smash" || hash === "fc") { ui.game = hash; }

    function savePrefs() {
        lset("fusion.bracket", { game: ui.game, view: ui.view, zoom: ui.zoom, follow: ui.follow, spectate: ui.spectate });
    }
    function isTO() { return ui.to && !ui.spectate; }
    function zoomVal() { return ui.zoom || (window.innerWidth < 600 ? 0.8 : 1); }

    // ---------- Server calls ----------
    function getState() {
        return fetch("/api/state", { headers: { accept: "application/json" } }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (body) {
                if (!r.ok) { var e = new Error(body.error || "The bracket server isn't answering (" + r.status + ")."); e.status = r.status; throw e; }
                return body;
            });
        });
    }
    function admin(path, method, body) {
        return fetch("/api/admin/" + path, {
            method: method,
            headers: { "content-type": "application/json", "x-fusion-key": ui.key || "" },
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (!r.ok) { var e = new Error(data.error || "That didn't work (" + r.status + ")."); e.status = r.status; throw e; }
                return data;
            });
        });
    }
    function applyState(s, own) {
        var next = fromApi(s);
        if (STATE && next.rev < STATE.rev) { return; } // an older copy from the edge cache
        var prev = STATE;
        if (prev && next.rev === prev.rev) { return; }
        STATE = next;
        DCACHE = {};
        if (!STATE.brackets.some(function (b) { return b.id === ui.game; })) { ui.game = STATE.brackets[0].id; }
        if (prev && !own) { notify(prev, STATE); }
        if (isTO() && !own && prev) { loadPlayersSoon(); }
        if (!own) { scheduleRender(); }
    }
    function op(body, okMsg) {
        if (ui.busy) { return Promise.resolve(null); }
        ui.busy = true;
        renderStatus();
        return admin("op", "POST", body).then(function (res) {
            ui.busy = false;
            if (res.players) { PLAYERS = res.players; }
            applyState(res.state, true);
            render();
            if (okMsg) { toast(okMsg); }
            return res;
        }).catch(function (err) {
            ui.busy = false;
            renderStatus();
            if (err.status === 401) { signOut(); toast("Signed out: " + err.message, "warn"); }
            else { toast(err.message || "That change didn't save. Try again.", "warn"); }
            return null;
        });
    }
    var playersTimer = null;
    function loadPlayers() {
        if (!ui.to) { return; }
        admin("players", "GET").then(function (res) { PLAYERS = res.players; scheduleRender(); }).catch(function (err) {
            if (err.status === 401) { signOut(); }
        });
    }
    function loadPlayersSoon() { clearTimeout(playersTimer); playersTimer = setTimeout(loadPlayers, 500); }
    function signOut() {
        ui.to = false; ui.key = null; PLAYERS = null; ui.modal = null;
        ldel("fusion.key");
        renderModal();
        render();
    }

    var pollTimer = null, failures = 0;
    function poll() {
        clearTimeout(pollTimer);
        if (document.hidden) { return; }
        getState().then(function (s) {
            failures = 0;
            ui.loadError = null;
            if (ui.offline) { ui.offline = false; renderStatus(); }
            if (!STATE) { STATE = fromApi(s); render(); return; }
            applyState(s, false);
            tick();
        }).catch(function (err) {
            failures++;
            if (!STATE) { ui.loadError = err.message; render(); }
            else if (failures >= 2 && !ui.offline) { ui.offline = true; renderStatus(); }
        }).then(function () {
            pollTimer = setTimeout(poll, failures ? Math.min(30000, POLL_MS * Math.pow(2, failures)) : POLL_MS);
        });
    }
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) { poll(); if (ui.big) { requestWake(); } }
    });

    // ---------- What changed since the last check ----------
    function notify(prev, next) {
        var msgs = [];
        next.brackets.forEach(function (b) {
            var pb = null;
            prev.brackets.forEach(function (x) { if (x.id === b.id) { pb = x; } });
            if (!pb) { return; }
            if (b.status === "live" && pb.status !== "live") { msgs.push([b.name + " bracket has started.", ""]); return; }
            if (b.status === "setup") {
                if (isTO()) {
                    var had = {};
                    pb.players.forEach(function (p) { had[p.id] = 1; });
                    var fresh = b.players.filter(function (p) { return !had[p.id]; });
                    if (fresh.length) { msgs.push(["New sign-up" + (fresh.length > 1 ? "s" : "") + ": " + fresh.map(function (p) { return p.name; }).join(", ") + " · " + b.name, ""]); }
                }
                return;
            }
            var D = derive(b), PD = Engine.run(pb);
            D.recent.forEach(function (id) {
                var o = D.out[id], po = PD.out[id];
                var now = o.winner.p + ":" + (o.score ? o.score.join("-") : "");
                var before = po && po.status === "done" ? po.winner.p + ":" + (po.score ? po.score.join("-") : "") : null;
                if (now === before) { return; }
                ui.flash[b.id + ":" + id] = 1;
                var wi = o.winner.p === o.slots[0].p ? 0 : 1;
                var sc = o.score && o.score[0] != null && o.score[1] != null ? " " + o.score[wi] + "–" + o.score[1 - wi] : "";
                msgs.push([D.P[o.winner.p].name + " beat " + D.P[o.loser.p].name + sc + " · " + b.name + " #" + D.st.M[id].num, ""]);
            });
            D.live.forEach(function (id) {
                if (pb.live[id]) { return; }
                var o = D.out[id], f = ui.follow[b.id];
                var mine = f && (o.slots[0].p === f || o.slots[1].p === f);
                msgs.push(["Now playing" + (o.setup ? " on Setup " + o.setup : "") + ": " + D.P[o.slots[0].p].name + " vs " + D.P[o.slots[1].p].name + " · " + b.name, mine ? "live" : ""]);
            });
        });
        msgs.slice(0, 3).forEach(function (m) { toast(m[0], m[1]); });
        if (msgs.length > 3) { toast("+" + (msgs.length - 3) + " more updates"); }
        setTimeout(function () { ui.flash = {}; }, 3200);
    }

    // ---------- Page head and tabs ----------
    function statusHTML() {
        if (!STATE) { return ""; }
        var anyLive = STATE.brackets.some(function (b) { return b.status === "live" && !derive(b).complete; });
        return (anyLive ? '<span class="fx-pill is-live"><span class="fx-dot"></span>Live</span>' : "") +
            '<span id="fx-upd">' + esc(STATE.updatedAt ? "Updated " + ago(STATE.updatedAt) : "Waiting for sign-ups") + "</span>" +
            (ui.busy ? '<span class="fx-pill"><span class="fx-spin"></span>Saving</span>' : "") +
            (ui.offline ? '<span class="fx-pill is-off">Reconnecting…</span>' : "");
    }
    function headHTML() {
        var actions = "";
        if (ui.to) {
            actions += '<button type="button" class="fx-switch" data-act="toggle-to" role="switch" aria-checked="' + !ui.spectate + '"><span class="sw"></span>Organizer tools</button>' +
                '<button type="button" class="fx-btn sm ghost" data-act="signout">Sign out</button>';
        } else {
            actions += '<button type="button" class="fx-btn sm ghost" data-act="signin">' + ICON.lock + "Organizer sign-in</button>";
        }
        actions += '<button type="button" class="fx-btn sm" data-act="big">' + ICON.tv + "Big screen</button>";
        return '<div class="fx-head"><div><h1 class="section-title">Bracket</h1><p class="fx-sub">Fusion Tournament · Ponyboat, Charlottetown</p></div>' +
            '<div class="fx-status" id="fx-status" aria-live="polite">' + statusHTML() + '</div><div class="fx-actions">' + actions + "</div></div>";
    }
    function tabsHTML() {
        return '<div class="fx-games" role="tablist" aria-label="Tournaments">' + STATE.brackets.map(function (b) {
            var D = derive(b), meta;
            if (b.status !== "live") {
                meta = '<span class="fx-chip">Sign-ups open</span><span>' + b.players.length + " signed up</span>";
            } else if (D.complete) {
                meta = '<span class="fx-chip win">' + ICON.crown + esc(D.P[D.champion].name) + "</span><span>Finished</span>";
            } else {
                meta = (D.live.length ? '<span class="fx-chip live"><span class="fx-dot"></span>' + D.live.length + " on now</span>" : '<span class="fx-chip on">In progress</span>') +
                    "<span>" + D.done + " / " + D.total + " matches</span>";
            }
            return '<button type="button" class="fx-tab" role="tab" id="fx-tab-' + esc(b.id) + '" aria-selected="' + (b.id === ui.game) + '" data-act="game" data-g="' + esc(b.id) + '" style="--gc:' + gc(b) + '">' +
                '<span class="fx-tab-name">' + esc(b.name) + '</span><span class="fx-tab-meta">' + meta + "</span></button>";
        }).join("") + "</div>";
    }

    // ---------- Game view ----------
    function gameHTML() {
        var b = cur();
        var inner = b.status === "live" ? liveHTML(b, derive(b)) : (isTO() ? organizerSetupHTML(b) : publicSetupHTML(b));
        return '<section class="fx-game" role="tabpanel" aria-labelledby="fx-tab-' + esc(b.id) + '" style="--gc:' + gc(b) + '">' + inner + "</section>";
    }

    function liveHTML(b, D) {
        var pct = D.total ? Math.round(100 * D.done / D.total) : 0;
        var h = '<div class="fx-ghead"><div><h2>' + esc(b.name) + "</h2><p>Double elimination · " + D.players.length + " players · " + (b.reset ? "bracket reset on" : "no bracket reset") + "</p></div>" +
            '<div class="fx-prog"><div class="fx-bar" role="progressbar" aria-label="Matches played" aria-valuemin="0" aria-valuemax="' + D.total + '" aria-valuenow="' + D.done + '"><i style="width:' + pct + '%"></i></div>' +
            "<span>" + D.done + " of " + D.total + " matches played" + (D.gf2Needed && !D.complete ? " · bracket reset, one more to go" : "") + "</span></div></div>";
        if (D.complete) {
            h += '<div class="fx-champ"><span class="fx-champ-ey">' + ICON.crown + "Fusion King · " + esc(b.name) + '</span><span class="fx-champ-name">' + esc(D.P[D.champion].name) + '</span><span class="fx-champ-sub">Runner-up: ' + esc(D.P[D.runnerUp].name) + "</span></div>";
        }
        h += followHTML(b, D);
        if (!D.complete) { h += nowHTML(b, D); }
        h += toolsHTML(b, D);
        h += "<div>" + (ui.view === "matches" ? matchesHTML(b, D) : ui.view === "standings" ? standingsHTML(b, D) : bracketHTML(b, D, { interactive: isTO() })) + "</div>";
        if (isTO()) { h += settingsHTML(b, D); }
        return h;
    }

    function oppText(D, id, pid) {
        var o = D.out[id], m = D.st.M[id];
        var i = o.slots[0] && o.slots[0].p === pid ? 1 : 0, s = o.slots[i];
        if (s && s.p) { return D.P[s.p].name; }
        if (id === "GF2") { return "the other finalist"; }
        return Engine.describe(D.st, m.src[i]).replace(/^W/, "w").replace(/^L/, "l");
    }
    function followHTML(b, D) {
        var pid = ui.follow[b.id];
        if (!pid || !D.P[pid]) { return ""; }
        var txt, cls = "";
        if (D.champion === pid) { txt = "Champion. Fusion King of " + b.name + "."; cls = "champ"; }
        else if (D.place[pid]) { txt = "Finished " + ord(D.place[pid].place) + (D.place[pid].out ? " · out in " + D.place[pid].out : "") + "."; }
        else {
            var nid = Engine.nextFor(D, pid);
            if (nid) {
                var o = D.out[nid], m = D.st.M[nid], opp = oppText(D, nid, pid);
                if (o.status === "live") { txt = "Playing now" + (o.setup ? " on Setup " + o.setup : "") + " vs " + opp + "."; cls = "live"; }
                else if (o.status === "ready") { txt = "Up next: match #" + m.num + " vs " + opp + "."; cls = "ready"; }
                else { txt = "Next: match #" + m.num + " vs " + opp + "."; }
                txt += " " + m.name + " · " + (D.rec[pid].l ? "losers side" : "winners side");
            } else { txt = "Waiting on the bracket."; }
        }
        return '<div class="fx-follow-band ' + cls + '" role="status"><span class="fx-fb-name">' + esc(D.P[pid].name) + '</span><span class="fx-fb-txt">' + esc(txt) + "</span>" +
            '<button type="button" class="fx-link" data-act="unfollow" data-g="' + esc(b.id) + '">Stop following</button></div>';
    }

    function nowHTML(b, D) {
        if (!D.live.length && !D.ready.length) { return ""; }
        var next = D.ready.slice(0, 4);
        var col = function (title, ids, total, empty, extra) {
            return '<div><h3 class="fx-sec-h">' + title + (total ? ' <span class="fx-cnt">' + total + "</span>" : "") + "</h3>" +
                (ids.length ? '<div class="fx-now-list">' + ids.map(function (id) { return miniHTML(b, D, id); }).join("") + "</div>" : '<p class="fx-muted">' + empty + "</p>") + (extra || "") + "</div>";
        };
        var more = D.ready.length > next.length ? '<p><button type="button" class="fx-link" data-act="view" data-v="matches">See all ' + D.ready.length + " matches that are ready</button></p>" : "";
        return '<div class="fx-now">' + col("On now", D.live, D.live.length, isTO() ? "Nothing called yet. Open a match and call it to a setup." : "Nothing on a setup right now.") +
            col("Up next", next, D.ready.length, "Waiting on results.", more) + "</div>";
    }
    function miniHTML(b, D, id) {
        var m = D.st.M[id], o = D.out[id], click = isTO();
        var nm = function (i) {
            var p = D.P[o.slots[i].p];
            return '<span class="p' + (ui.follow[b.id] === p.id ? " is-follow" : "") + '">' + esc(p.name) + "</span>";
        };
        var chip = o.status === "live" ? '<span class="fx-chip live"><span class="fx-dot"></span>' + (o.setup ? "Setup " + esc(o.setup) : "Live") + "</span>" : "";
        var inner = '<span class="fx-mini-top"><b>#' + m.num + '</b><span class="rd">' + esc(m.name) + "</span>" + chip + "</span>" +
            '<span class="fx-mini-vs">' + nm(0) + '<span class="vs">VS</span>' + nm(1) + "</span>";
        return click
            ? '<button type="button" class="fx-mini st-' + o.status + '" data-act="open" data-g="' + esc(b.id) + '" data-id="' + id + '">' + inner + "</button>"
            : '<div class="fx-mini st-' + o.status + '">' + inner + "</div>";
    }

    function toolsHTML(b, D) {
        var seg = [["bracket", "Bracket"], ["matches", "Matches"], ["standings", "Standings"]].map(function (v) {
            return '<button type="button" role="tab" aria-selected="' + (ui.view === v[0]) + '" data-act="view" data-v="' + v[0] + '">' + v[1] + "</button>";
        }).join("");
        var opts = '<option value="">Follow a player…</option>' + D.players.slice().sort(function (x, y) { return x.name.localeCompare(y.name); }).map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (ui.follow[b.id] === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>";
        }).join("");
        var zoom = ui.view === "bracket"
            ? '<div class="fx-zoom" role="group" aria-label="Bracket zoom"><button type="button" class="fx-icon-btn" data-act="zoom" data-d="-1" aria-label="Zoom out">−</button><span>' + Math.round(zoomVal() * 100) + '%</span><button type="button" class="fx-icon-btn" data-act="zoom" data-d="1" aria-label="Zoom in">+</button></div>' : "";
        return '<div class="fx-tools"><div class="fx-seg" role="tablist" aria-label="View">' + seg + "</div>" +
            '<label class="fx-follow" for="fx-follow-' + esc(b.id) + '"><span class="fx-sr">Follow a player</span><select id="fx-follow-' + esc(b.id) + '" data-follow="' + esc(b.id) + '">' + opts + "</select></label>" + zoom + "</div>";
    }

    // ---------- Bracket canvas ----------
    function geo() {
        return window.innerWidth < 600 ? { cw: 170, gx: 28, hh: 17, rh: 27, gy: 12 } : { cw: 212, gx: 44, hh: 17, rh: 28, gy: 16 };
    }
    function bracketHTML(b, D, opt) {
        opt = opt || {};
        var st = D.st, g = geo();
        var CH = g.hh + 2 * g.rh + 3, U = CH + g.gy, pos = {};
        st.W.forEach(function (col, r) {
            col.forEach(function (id, i) {
                var m = st.M[id];
                pos[id] = { y: r === 0 ? i * U : (pos[m.src[0].w].y + pos[m.src[1].w].y) / 2 };
            });
        });
        st.L.forEach(function (col, ri) {
            col.forEach(function (id, i) {
                var m = st.M[id], rd = ri + 1;
                pos[id] = { y: rd === 1 ? i * U : rd % 2 === 0 ? pos[m.src[0].w].y : (pos[m.src[0].w].y + pos[m.src[1].w].y) / 2 };
            });
        });
        var vis = function (col) { return col.some(function (id) { return !st.M[id].auto; }); };
        var wx = [], lx = [], nW = 0, nL = 0;
        st.W.forEach(function (col, i) { wx[i] = vis(col) ? nW++ : null; });
        st.L.forEach(function (col, i) { lx[i] = vis(col) ? nL++ : null; });
        var step = g.cw + g.gx, colX = function (n) { return n * step; };
        var wTop = 56, wH = (st.S / 2) * U - g.gy;
        var lTop = wTop + wH + 84, lH = st.LR ? (st.S / 4) * U - g.gy : 0;
        st.W.forEach(function (col, r) { col.forEach(function (id) { pos[id].x = wx[r] == null ? null : colX(wx[r]); pos[id].y += wTop; }); });
        st.L.forEach(function (col, r) { col.forEach(function (id) { pos[id].x = lx[r] == null ? null : colX(lx[r]); pos[id].y += lTop; }); });
        var mid = function (id) { return pos[id].y + g.hh + g.rh + 1.5; };
        var wf = "W" + st.k + "-1", lf = st.LR ? "L" + st.LR + "-1" : null;
        var gfCol = Math.max(nW, nL);
        var gfY = lf ? (mid(wf) + mid(lf)) / 2 - (g.hh + g.rh + 1.5) : pos[wf].y;
        pos.GF1 = { x: colX(gfCol), y: gfY };
        if (st.M.GF2) { pos.GF2 = { x: colX(gfCol + 1), y: gfY }; }
        var width = colX(gfCol + (st.M.GF2 ? 2 : 1)) - g.gx;
        var height = Math.ceil((st.LR ? lTop + lH : wTop + wH) + 4);

        var paths = [];
        var outPt = function (id) { return [pos[id].x + g.cw, mid(id)]; };
        var inPt = function (id, s) { return [pos[id].x, pos[id].y + g.hh + 1 + (s ? g.rh * 1.5 + 1 : g.rh / 2)]; };
        st.seq.forEach(function (id) {
            var m = st.M[id];
            if (m.auto || pos[id].x == null) { return; }
            if (id === "GF2") {
                var a0 = outPt("GF1");
                paths.push('<path class="ln dash" d="M' + a0[0] + " " + a0[1] + "H" + pos.GF2.x + '"/>');
                return;
            }
            m.src.forEach(function (s, si) {
                if (!s.w || st.M[s.w].auto || pos[s.w].x == null) { return; }
                var a = outPt(s.w), c = inPt(id, si), mx = c[0] - g.gx / 2;
                paths.push('<path class="ln' + (D.out[s.w].done ? " on" : "") + '" d="M' + a[0] + " " + a[1] + "H" + mx + "V" + c[1] + "H" + c[0] + '"/>');
            });
        });

        var labels = ['<div class="sec-lab" style="top:0">Winners side</div>'];
        st.W.forEach(function (col, r) {
            if (wx[r] == null) { return; }
            labels.push('<div class="col-lab" style="left:' + colX(wx[r]) + "px;top:32px;width:" + g.cw + 'px">' + esc(st.M[col[0]].name) + "</div>");
        });
        if (st.LR) {
            labels.push('<div class="sec-lab" style="top:' + (lTop - 56) + 'px">Losers side</div>');
            st.L.forEach(function (col, r) {
                if (lx[r] == null) { return; }
                labels.push('<div class="col-lab" style="left:' + colX(lx[r]) + "px;top:" + (lTop - 24) + "px;width:" + g.cw + 'px">' + esc(st.M[col[0]].name) + "</div>");
            });
        }
        labels.push('<div class="col-lab gf" style="left:' + pos.GF1.x + "px;top:" + (gfY - 22) + "px;width:" + g.cw + 'px">Grand Final</div>');
        if (st.M.GF2) { labels.push('<div class="col-lab gf" style="left:' + pos.GF2.x + "px;top:" + (gfY - 22) + "px;width:" + g.cw + 'px">Bracket reset</div>'); }

        var cards = st.seq.filter(function (id) { return !st.M[id].auto && pos[id].x != null; })
            .map(function (id) { return cardHTML(b, D, id, pos[id], opt); }).join("");
        var z = zoomVal();
        return '<div class="bk-scroll"' + (opt.preview ? "" : ' id="bk-scroll"') + ' tabindex="0" aria-label="' + esc(b.name) + ' bracket">' +
            '<div class="bk-zoom" style="width:' + Math.ceil(width * z) + "px;height:" + Math.ceil(height * z) + 'px">' +
            '<div class="bk" style="--cw:' + g.cw + "px;--rh:" + g.rh + "px;width:" + width + "px;height:" + height + "px;transform:scale(" + z + ')">' +
            '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true">' + paths.join("") + "</svg>" +
            labels.join("") + cards + "</div></div></div>";
    }
    function statusTag(o) {
        if (o.status === "live") { return '<span class="mc-live"><span class="fx-dot"></span>' + (o.setup ? "Setup " + esc(o.setup) : "Live") + "</span>"; }
        if (o.status === "ready") { return '<span class="mc-ready">Up next</span>'; }
        if (o.status === "skipped") { return '<span class="mc-skip">Not needed</span>'; }
        return "";
    }
    function cardHTML(b, D, id, p, opt) {
        var m = D.st.M[id], o = D.out[id];
        var click = opt.interactive && (o.status === "ready" || o.status === "live" || o.status === "done");
        var cls = "mc st-" + o.status + (click ? " is-click" : "") + (ui.flash[b.id + ":" + id] ? " flash" : "");
        var attrs = click ? ' role="button" tabindex="0" data-act="open" data-g="' + esc(b.id) + '" data-id="' + id + '" aria-label="' + esc("Report match " + m.num) + '"' : "";
        return '<div class="' + cls + '" style="left:' + p.x + "px;top:" + p.y + 'px"' + attrs + ">" +
            '<div class="mc-h"><span>' + (m.num ? "#" + m.num : "") + "</span>" + (opt.preview ? "" : statusTag(o)) + "</div>" +
            '<div class="mc-box">' + rowHTML(b, D, id, 0, opt) + rowHTML(b, D, id, 1, opt) + "</div></div>";
    }
    function rowHTML(b, D, id, i, opt) {
        var m = D.st.M[id], o = D.out[id], s = o.slots[i];
        if (s && s.p) {
            var pl = D.P[s.p], w = o.done && o.winner.p === s.p, l = o.done && o.loser.p === s.p;
            if (opt.placeholder) {
                return '<div class="mc-r tbd"><span class="sd"></span><span class="nm"><span>' + esc(pl.name) + '</span></span><span class="sc"></span></div>';
            }
            var sc = o.score && o.score[i] != null ? o.score[i] : (o.done ? (w ? "W" : "L") : "");
            var crown = (id === "GF1" || id === "GF2") && w && D.champion === s.p ? ICON.crown : "";
            var fol = !opt.preview && ui.follow[b.id] === s.p ? " is-follow" : "";
            return '<div class="mc-r' + (w ? " is-w" : "") + (l ? " is-l" : "") + fol + '"><span class="sd">' + pl.seed + "</span>" +
                '<span class="nm' + lenCls(pl.name) + '" title="' + esc(pl.name) + '">' + crown + "<span>" + esc(pl.name) + '</span></span><span class="sc">' + esc(sc) + "</span></div>";
        }
        var txt = id === "GF2" ? (o.status === "skipped" ? "" : (i === 0 ? "Winners finalist" : "Losers finalist")) : Engine.describe(D.st, m.src[i]);
        return '<div class="mc-r tbd"><span class="sd"></span><span class="nm"><span>' + esc(txt) + '</span></span><span class="sc"></span></div>';
    }

    // ---------- Match list and standings ----------
    function matchesHTML(b, D) {
        var st = D.st, out = D.out;
        var waiting = st.seq.filter(function (id) { return !st.M[id].auto && (out[id].status === "waiting" || out[id].status === "pending"); });
        var secs = [["On now", D.live, "Nothing on a setup right now."], ["Up next", D.ready, "Nothing ready yet."], ["Waiting on earlier results", waiting, "None."], ["Finished", D.recent, "No results yet."]];
        return '<div class="fx-ml">' + secs.map(function (s) {
            return '<section><h3 class="fx-sec-h">' + s[0] + ' <span class="fx-cnt">' + s[1].length + "</span></h3>" +
                (s[1].length ? '<div class="fx-ml-list">' + s[1].map(function (id) { return listRowHTML(b, D, id); }).join("") + "</div>" : '<p class="fx-muted">' + s[2] + "</p>") + "</section>";
        }).join("") + "</div>";
    }
    function listRowHTML(b, D, id) {
        var m = D.st.M[id], o = D.out[id];
        var click = isTO() && (o.status === "ready" || o.status === "live" || o.status === "done");
        var side = function (i) {
            var s = o.slots[i];
            if (s && s.p) {
                var pl = D.P[s.p], w = o.done && o.winner.p === s.p;
                return '<span class="fx-lr-p' + (w ? " is-w" : o.done ? " is-l" : "") + (ui.follow[b.id] === s.p ? " is-follow" : "") + '"><span>' + esc(pl.name) + "</span>" +
                    (o.score && o.score[i] != null ? '<b class="fx-lr-sc">' + o.score[i] + "</b>" : "") + "</span>";
            }
            return '<span class="fx-lr-p tbd">' + esc(id === "GF2" ? (i ? "Losers finalist, if needed" : "Winners finalist") : Engine.describe(D.st, m.src[i])) + "</span>";
        };
        var stat = o.status === "live" ? '<span class="fx-chip live"><span class="fx-dot"></span>' + (o.setup ? "Setup " + esc(o.setup) : "Live") + "</span>"
            : o.status === "ready" ? '<span class="fx-chip on">Ready</span>'
            : o.status === "done" ? esc(ago(o.t)) : "Waiting";
        var inner = '<span class="fx-lr-n">#' + m.num + '</span><span class="fx-lr-r">' + esc(m.name) + '</span><span class="fx-lr-ps">' + side(0) + '<span class="vs">VS</span>' + side(1) + '</span><span class="fx-lr-s">' + stat + "</span>";
        return click
            ? '<button type="button" class="fx-lr st-' + o.status + '" data-act="open" data-g="' + esc(b.id) + '" data-id="' + id + '">' + inner + "</button>"
            : '<div class="fx-lr st-' + o.status + '">' + inner + "</div>";
    }
    function standingsHTML(b, D) {
        var placed = D.players.filter(function (p) { return D.place[p.id]; }).sort(function (x, y) {
            return D.place[x.id].place - D.place[y.id].place || x.name.localeCompare(y.name);
        });
        var alive = D.players.filter(function (p) { return !D.place[p.id]; });
        var h = '<div class="fx-ml">';
        if (alive.length) {
            h += '<section><h3 class="fx-sec-h">Still in <span class="fx-cnt">' + alive.length + '</span></h3><div class="fx-alive">' + alive.map(function (p) {
                return "<span>" + esc(p.name) + "<small>" + (D.rec[p.id].l ? "Losers side" : "Winners side") + " · " + D.rec[p.id].w + "–" + D.rec[p.id].l + "</small></span>";
            }).join("") + "</div></section>";
        }
        h += '<section><h3 class="fx-sec-h">Final placings <span class="fx-cnt">' + placed.length + "</span></h3>";
        if (!placed.length) {
            h += '<p class="fx-muted">Placings fill in as players are knocked out. Two losses and you’re out.</p>';
        } else {
            h += '<div class="fx-tbl-wrap"><table><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Record</th><th scope="col">Out in</th></tr></thead><tbody>' +
                placed.map(function (p) {
                    var pl = D.place[p.id];
                    return '<tr class="' + (pl.place === 1 ? "p1" : "") + (ui.follow[b.id] === p.id ? " is-follow" : "") + '"><td class="pl">' + ord(pl.place) + '</td><td class="pn">' + (pl.place === 1 ? ICON.crown + " " : "") + esc(p.name) + "</td>" +
                        '<td class="rc">' + D.rec[p.id].w + "–" + D.rec[p.id].l + "</td><td>" + esc(pl.out || "Champion") + "</td></tr>";
                }).join("") + "</tbody></table></div>";
        }
        return h + "</section></div>";
    }

    // ---------- Sign-ups (bracket not started) ----------
    function previewHTML(b, names) {
        var ph = names.length < 2;
        var list = ph ? ["Seed 1", "Seed 2", "Seed 3", "Seed 4", "Seed 5", "Seed 6", "Seed 7", "Seed 8"] : names;
        var D = Engine.run({ players: list.map(function (n, i) { return { id: "x" + i, name: n }; }), reset: b.reset, results: {}, live: {} });
        return '<div><div class="fx-prev-head"><h3>Bracket preview</h3><span class="fx-muted">' +
            (ph ? "Fills in as people sign up" : "Seeds can change until the bracket starts") + "</span></div>" +
            bracketHTML(b, D, { interactive: false, preview: true, placeholder: ph }) + "</div>";
    }
    function publicSetupHTML(b) {
        var n = b.players.length;
        return '<div class="fx-ghead"><div><h2>' + esc(b.name) + "</h2><p>Double elimination · sign-ups are open</p></div></div>" +
            '<div class="fx-card"><div class="fx-reg-head"><h3>' + (n ? n + " signed up" : "No sign-ups yet") + '</h3><a class="btn btn-primary" href="index.html#register">Sign up</a></div>' +
            (n ? '<ol class="fx-reg-list">' + b.players.map(function (p) { return "<li>" + esc(p.name) + "</li>"; }).join("") + "</ol>"
                : '<p class="fx-muted">Sign up on the home page and your gamer tag shows up here right away.</p>') + "</div>" +
            previewHTML(b, b.players.map(function (p) { return p.name; }));
    }
    function organizerSetupHTML(b) {
        var g = b.id, info = {}, removed = [];
        (PLAYERS || []).forEach(function (p) {
            info[p.id] = p;
            (p.entries || []).forEach(function (e) { if (e.game === g && e.removed) { removed.push(p); } });
        });
        var n = b.players.length;
        var rows = b.players.map(function (p, i) {
            var x = info[p.id] || {};
            return "<tr>" +
                '<td class="seed">' + (i + 1) + "</td>" +
                '<td class="tag">' + esc(p.name) + (x.source === "walk-in" ? '<span class="fx-tag-src">Walk-in</span>' : "") + "</td>" +
                '<td class="who">' + (x.id ? "<b>" + esc(x.name || "No name given") + "</b>" + esc(x.email || "") : '<span class="fx-hint">Loading…</span>') + "</td>" +
                '<td><label class="fx-paid"><input type="checkbox" data-paid="' + esc(p.id) + '"' + (x.paid ? " checked" : "") + (x.id ? "" : " disabled") + "> Paid</label></td>" +
                '<td class="acts"><button type="button" class="fx-icon-btn" data-act="move" data-d="-1" data-pid="' + esc(p.id) + '" aria-label="' + esc("Move " + p.name + " up") + '"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
                '<button type="button" class="fx-icon-btn" data-act="move" data-d="1" data-pid="' + esc(p.id) + '" aria-label="' + esc("Move " + p.name + " down") + '"' + (i === n - 1 ? " disabled" : "") + ">↓</button>" +
                '<button type="button" class="fx-btn sm ghost" data-act="remove" data-pid="' + esc(p.id) + '">Remove</button></td></tr>';
        }).join("");
        var start = ui.confirm === "start:" + g
            ? '<div class="fx-confirm"><p>Start ' + esc(b.name) + " with " + n + " players? Sign-ups for this game close and the seeds lock.</p>" +
              '<div class="fx-setup-bar"><button type="button" class="fx-btn sm" data-act="confirm-cancel">Not yet</button><button type="button" class="fx-btn sm primary" data-act="start-go">Start bracket</button></div></div>'
            : '<button type="button" class="fx-btn primary" data-act="start-ask"' + (n < 2 ? " disabled" : "") + ">Start bracket</button>";
        return '<div class="fx-ghead"><div><h2>' + esc(b.name) + "</h2><p>Sign-ups open · " + n + " in the bracket" + (removed.length ? " · " + removed.length + " removed" : "") + "</p></div></div>" +
            '<div class="fx-setup">' +
            '<div class="fx-setup-bar"><button type="button" class="fx-btn sm" data-act="shuffle"' + (n < 2 ? " disabled" : "") + ">" + ICON.shuffle + "Shuffle seeds</button>" +
            '<button type="button" class="fx-btn sm ghost" data-act="signup-order"' + (n < 2 ? " disabled" : "") + '>Back to sign-up order</button><span class="grow"></span>' + start + "</div>" +
            (n ? '<div class="fx-tbl-wrap fx-su"><table><thead><tr><th scope="col">Seed</th><th scope="col">Gamer tag</th><th scope="col">Real name and email</th><th scope="col">Ticket</th><th scope="col"><span class="fx-sr">Actions</span></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
                : '<p class="fx-muted">No sign-ups yet. They appear here the moment someone signs up on the home page.</p>') +
            '<form class="fx-inline-form" data-form="walkin" autocomplete="off"><label class="fx-sr" for="fx-walkin">Walk-in gamer tag</label><input class="fx-inp" id="fx-walkin" maxlength="24" placeholder="Add a walk-in by gamer tag"><button type="submit" class="fx-btn">Add walk-in</button></form>' +
            (removed.length ? '<details class="fx-removed" data-removed="' + esc(g) + '"' + (ui.removedOpen[g] ? " open" : "") + "><summary>Removed (" + removed.length + ")</summary><ul>" + removed.map(function (p) {
                return "<li><span>" + esc(p.tag) + '</span><button type="button" class="fx-btn sm" data-act="restore" data-pid="' + esc(p.id) + '">Put back</button></li>';
            }).join("") + "</ul></details>" : "") +
            '<label class="fx-check" for="fx-reset-' + esc(g) + '"><input type="checkbox" id="fx-reset-' + esc(g) + '" data-reset="' + esc(g) + '"' + (b.reset ? " checked" : "") + "><span>Bracket reset: if the losers-side finalist wins the Grand Final, they play one more match</span></label>" +
            "</div>" + previewHTML(b, b.players.map(function (p) { return p.name; })) + namesHTML(b);
    }

    // ---------- Settings (organizers) ----------
    function namesHTML(b) {
        if (!b.players.length) { return ""; }
        return '<details class="fx-settings" data-settings="' + esc(b.id) + '"' + (ui.settingsOpen[b.id] ? " open" : "") + '><summary>Fix a gamer tag</summary><div class="fx-set-grid"><section>' +
            '<p class="fx-hint">Seeds and results stay as they are.</p><div class="fx-nm-list">' + b.players.map(function (p, i) {
                return '<label class="fx-nm-edit" for="fx-pn-' + esc(p.id) + '"><span>' + (i + 1) + '</span><input class="fx-inp" id="fx-pn-' + esc(p.id) + '" data-pid="' + esc(p.id) + '" data-was="' + esc(p.name) + '" value="' + esc(p.name) + '" maxlength="24" autocomplete="off"></label>';
            }).join("") + '</div><div><button type="button" class="fx-btn sm" data-act="save-names">Save tags</button></div></section></div></details>';
    }
    function settingsHTML(b, D) {
        var gfDone = D.out.GF1 && D.out.GF1.status === "done";
        var reopen = ui.confirm === "reopen:" + b.id
            ? '<div class="fx-confirm danger"><p>Clear all ' + D.done + " result" + (D.done === 1 ? "" : "s") + " and reopen sign-ups for " + esc(b.name) + "?</p>" +
              '<div class="fx-setup-bar"><button type="button" class="fx-btn sm" data-act="confirm-cancel">Keep the bracket</button><button type="button" class="fx-btn sm danger" data-act="reopen-go">Clear results and reopen</button></div></div>'
            : '<div><button type="button" class="fx-btn sm danger" data-act="reopen-ask">Back to sign-ups</button></div>';
        return '<details class="fx-settings" data-settings="' + esc(b.id) + '"' + (ui.settingsOpen[b.id] ? " open" : "") + '><summary>Bracket settings</summary><div class="fx-set-grid">' +
            '<section><h4>Fix a gamer tag</h4><p class="fx-hint">Seeds and results stay as they are.</p><div class="fx-nm-list">' + D.players.map(function (p, i) {
                return '<label class="fx-nm-edit" for="fx-pn-' + esc(p.id) + '"><span>' + (i + 1) + '</span><input class="fx-inp" id="fx-pn-' + esc(p.id) + '" data-pid="' + esc(p.id) + '" data-was="' + esc(p.name) + '" value="' + esc(p.name) + '" maxlength="24" autocomplete="off"></label>';
            }).join("") + '</div><div><button type="button" class="fx-btn sm" data-act="save-names">Save tags</button></div></section>' +
            '<section><h4>Grand Final</h4><label class="fx-check" for="fx-reset-' + esc(b.id) + '"><input type="checkbox" id="fx-reset-' + esc(b.id) + '" data-reset="' + esc(b.id) + '"' + (b.reset ? " checked" : "") + (gfDone ? " disabled" : "") + "><span>Bracket reset: if the losers-side finalist wins the Grand Final, they play one more match</span></label>" +
            (gfDone ? '<p class="fx-hint">Locked once the Grand Final has a result.</p>' : "") + "</section>" +
            '<section><h4>Start over</h4><p class="fx-hint">Clears every result and reopens sign-ups. Everyone stays signed up.</p>' + reopen + "</section>" +
            "</div></details>";
    }

    // ---------- Big screen ----------
    var WAKE = null;
    function renderBig() {
        var root = document.getElementById("fx-big");
        if (!root) { return; }
        document.documentElement.classList.toggle("fx-is-big", ui.big && !!STATE);
        if (!ui.big || !STATE) { root.innerHTML = ""; return; }
        root.innerHTML = '<div class="fx-bs" role="region" aria-label="Big screen">' +
            '<div class="fx-bs-top"><img src="img/logo-small.png" width="480" height="180" alt="Fusion Tournament"><span class="fx-bs-ev">Ponyboat · Charlottetown</span>' +
            '<span class="fx-bs-clock" id="fx-bs-clock">' + esc(clock()) + '</span><span class="fx-bs-upd" id="fx-bs-upd">' + esc(STATE.updatedAt ? "Updated " + ago(STATE.updatedAt) : "") + "</span>" +
            '<button type="button" class="fx-btn sm" data-act="big-exit">Exit big screen</button></div>' +
            '<div class="fx-bs-grid">' + STATE.brackets.map(bigCol).join("") + "</div></div>";
    }
    function bigCol(b) {
        var D = derive(b);
        var vs = function (o, i) { return esc(D.P[o.slots[i].p].name); };
        var h = '<section class="fx-bs-col" style="--gc:' + gc(b) + '"><header class="fx-bs-h"><h2>' + esc(b.name) + '</h2><span class="fx-bs-prog">' +
            (b.status === "live" ? D.done + " / " + D.total + " matches" : b.players.length + " signed up") + "</span></header>";
        if (b.status !== "live") {
            return h + '<div class="fx-bs-block"><h3>Sign-ups open</h3><p class="fx-bs-big">' + (b.players.length ? b.players.map(function (p) { return esc(p.name); }).join(" · ") : "Sign up at the front desk or on the site") + "</p></div></section>";
        }
        if (D.complete) {
            h += '<div class="fx-bs-champ">' + ICON.crown + '<span class="ey">Fusion King</span><span class="nm">' + esc(D.P[D.champion].name) + "</span></div>";
        } else {
            h += '<div class="fx-bs-block"><h3>On now</h3>' + (D.live.length ? D.live.map(function (id) {
                var o = D.out[id], m = D.st.M[id];
                return '<div class="fx-bs-live"><span class="fx-bs-setup">' + (o.setup ? "Setup<b>" + esc(o.setup) + "</b>" : "<b>Live</b>") + '</span><span class="fx-bs-p">' + vs(o, 0) + '</span><span class="vs">VS</span><span class="fx-bs-p">' + vs(o, 1) + "</span>" +
                    '<span class="fx-bs-rd">#' + m.num + " · " + esc(m.name) + "</span></div>";
            }).join("") : '<p class="fx-bs-empty">No matches on a setup</p>') + "</div>";
            h += '<div class="fx-bs-block"><h3>Up next</h3>' + (D.ready.length ? D.ready.slice(0, 5).map(function (id) {
                var o = D.out[id], m = D.st.M[id];
                return '<div class="fx-bs-row"><span class="fx-bs-n">#' + m.num + '</span><span class="fx-bs-vs">' + vs(o, 0) + '<span class="vs">VS</span>' + vs(o, 1) + '</span><span class="fx-bs-meta">' + esc(m.name) + "</span></div>";
            }).join("") : '<p class="fx-bs-empty">Waiting on results</p>') + "</div>";
        }
        h += '<div class="fx-bs-block"><h3>Latest results</h3>' + (D.recent.length ? D.recent.slice(0, 4).map(function (id) {
            var o = D.out[id], m = D.st.M[id], wi = o.winner.p === o.slots[0].p ? 0 : 1;
            var sc = o.score && o.score[0] != null && o.score[1] != null ? ' <span class="s">' + o.score[wi] + "–" + o.score[1 - wi] + "</span>" : "";
            return '<div class="fx-bs-row"><span class="fx-bs-n">#' + m.num + '</span><span class="fx-bs-vs">' + vs(o, wi) + sc + ' <span class="l"><span class="vs">def.</span>' + vs(o, 1 - wi) + '</span></span><span class="fx-bs-meta">' + esc(m.name) + "</span></div>";
        }).join("") : '<p class="fx-bs-empty">No results yet</p>') + "</div>";
        return h + "</section>";
    }
    function requestWake() {
        try {
            if (navigator.wakeLock && navigator.wakeLock.request) { navigator.wakeLock.request("screen").then(function (l) { WAKE = l; }).catch(function () {}); }
        } catch (e) {}
    }
    function enterBig() {
        ui.big = true;
        render();
        try { var el = document.documentElement; if (el.requestFullscreen) { var pr = el.requestFullscreen(); if (pr && pr.catch) { pr.catch(function () {}); } } } catch (e) {}
        requestWake();
    }
    function exitBig() {
        ui.big = false;
        render();
        try { if (document.fullscreenElement && document.exitFullscreen) { var pr = document.exitFullscreen(); if (pr && pr.catch) { pr.catch(function () {}); } } } catch (e) {}
        if (WAKE) { try { WAKE.release(); } catch (e) {} WAKE = null; }
    }

    // ---------- Dialogs: report a match, organizer sign-in ----------
    function openModal(g, id) {
        var b = byId(g), D = derive(b), o = D.out[id];
        if (!isTO() || !o || ["ready", "live", "done"].indexOf(o.status) < 0) { return; }
        var pick = null, s = ["", ""];
        if (o.status === "done") {
            pick = o.winner.p === o.slots[0].p ? 0 : 1;
            if (o.score) { s = [o.score[0] == null ? "" : String(o.score[0]), o.score[1] == null ? "" : String(o.score[1])]; }
        }
        ui.modal = { kind: "match", g: g, id: id, pick: pick, s: s, manual: o.status === "done", confirmClear: false, setup: o.setup || "", back: document.activeElement };
        renderModal();
        var first = document.querySelector('.fx-pk[data-i="0"]');
        if (first) { first.focus(); }
    }
    function openSignin() {
        ui.modal = { kind: "signin", error: "", back: document.activeElement };
        renderModal();
        var inp = document.getElementById("fx-key");
        if (inp) { inp.focus(); }
    }
    function closeModal() {
        var back = ui.modal && ui.modal.back;
        ui.modal = null;
        renderModal();
        if (back && document.body.contains(back)) { try { back.focus(); } catch (e) {} }
    }
    function impactCount(b, id, pick) {
        var D = derive(b), nb = JSON.parse(JSON.stringify(b)), o = D.out[id];
        if (pick == null) { delete nb.results[id]; }
        else { nb.results[id] = { a: o.slots[0].p, b: o.slots[1].p, w: o.slots[pick].p }; }
        var D2 = Engine.run(nb);
        return D.recent.filter(function (x) { return x !== id && D2.out[x].status !== "done"; }).length;
    }
    function modalWarn() {
        var M = ui.modal, b = byId(M.g), D = derive(b), o = D.out[M.id], msgs = [];
        var a = toNum(M.s[0]), c = toNum(M.s[1]);
        if (M.pick != null && a != null && c != null && a !== c && (a > c ? 0 : 1) !== M.pick) { msgs.push("The score says the other player won. Check who you picked."); }
        if (o.status === "done" && M.pick != null && o.winner.p !== o.slots[M.pick].p) {
            var n = impactCount(b, M.id, M.pick);
            if (n) { msgs.push("Changing the winner clears " + n + " later result" + (n > 1 ? "s" : "") + ". Those matches need to be entered again."); }
        }
        return msgs.map(function (t) { return "<p>" + ICON.warn + "<span>" + esc(t) + "</span></p>"; }).join("");
    }
    function renderModal() {
        var root = document.getElementById("fx-modal");
        if (!root) { return; }
        var M = ui.modal;
        if (!M) { root.innerHTML = ""; return; }
        if (M.kind === "signin") {
            root.innerHTML = '<div class="fx-scrim" data-act="scrim"><form class="fx-modal" role="dialog" aria-modal="true" aria-labelledby="fx-si-title" data-form="signin">' +
                '<div class="fx-m-head"><div><p class="fx-eyebrow">Organizers only</p><h2 id="fx-si-title">Sign in</h2></div><button type="button" class="fx-icon-btn" data-act="close-modal" aria-label="Close">×</button></div>' +
                '<div class="fx-m-body"><label class="fx-lbl" for="fx-key">Organizer password</label><input class="fx-inp" id="fx-key" type="password" autocomplete="current-password" required>' +
                '<p class="fx-hint">Lets you manage sign-ups, start brackets and report results on this device. Ask Tommy for the password.</p>' +
                (M.error ? '<p class="fx-m-err" role="alert">' + esc(M.error) + "</p>" : "") + "</div>" +
                '<div class="fx-m-foot"><span class="sp"></span><button type="button" class="fx-btn" data-act="close-modal">Cancel</button><button type="submit" class="fx-btn primary" id="fx-si-go">Sign in</button></div></form></div>';
            return;
        }
        if (!STATE) { ui.modal = null; root.innerHTML = ""; return; }
        var b = byId(M.g), D = derive(b), m = D.st.M[M.id], o = D.out[M.id];
        if (!o || ["ready", "live", "done"].indexOf(o.status) < 0) { ui.modal = null; root.innerHTML = ""; return; }
        var pl = function (i) { return D.P[o.slots[i].p]; };
        var pick = function (i) {
            return '<div class="fx-pk-row"><button type="button" class="fx-pk' + (M.pick === i ? " on" : "") + '" data-act="pick" data-i="' + i + '" aria-pressed="' + (M.pick === i) + '">' +
                '<span class="fx-pk-seed">Seed ' + pl(i).seed + '</span><span class="fx-pk-name">' + esc(pl(i).name) + '</span><span class="fx-pk-mark">' + (M.pick === i ? "Winner" : "Won?") + "</span></button>" +
                '<div class="fx-stepper"><button type="button" class="fx-icon-btn" data-act="sc" data-i="' + i + '" data-d="-1" aria-label="' + esc("Lower " + pl(i).name + "’s score") + '">−</button>' +
                '<input class="fx-inp fx-sc-inp" id="fx-msc-' + i + '" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="' + esc(pl(i).name + " score") + '" placeholder="–" value="' + esc(M.s[i]) + '">' +
                '<button type="button" class="fx-icon-btn" data-act="sc" data-i="' + i + '" data-d="1" aria-label="' + esc("Raise " + pl(i).name + "’s score") + '">+</button></div></div>';
        };
        var live = "";
        if (o.status === "live") {
            live = '<div class="fx-m-live"><span class="fx-chip live"><span class="fx-dot"></span>' + (o.setup ? "On Setup " + esc(o.setup) : "Playing now") + '</span><span class="sp"></span><button type="button" class="fx-btn sm ghost" data-act="unlive">Not playing yet</button></div>';
        } else if (o.status === "ready") {
            live = '<div class="fx-m-live"><label class="fx-lbl" for="fx-m-setup">Setup</label><input class="fx-inp" id="fx-m-setup" maxlength="12" autocomplete="off" placeholder="e.g. 2" value="' + esc(M.setup) + '">' +
                '<button type="button" class="fx-btn sm" data-act="go-live">' + ICON.call + "Call to setup</button></div>";
        }
        var foot = "";
        if (o.status === "done") {
            if (M.confirmClear) {
                var n = impactCount(b, M.id, null);
                foot += '<span class="fx-m-confirm">Clear this result' + (n ? " and " + n + " later one" + (n > 1 ? "s" : "") : "") + '?</span><button type="button" class="fx-btn sm" data-act="clear-no">Keep</button><button type="button" class="fx-btn sm danger" data-act="clear-yes">Clear</button>';
            } else {
                foot += '<button type="button" class="fx-btn sm ghost" data-act="clear-ask">Clear result</button>';
            }
        }
        foot += '<span class="sp"></span><button type="button" class="fx-btn" data-act="close-modal">Cancel</button><button type="button" class="fx-btn primary" id="fx-m-save" data-act="save-result"' + (M.pick == null ? " disabled" : "") + ">Save result</button>";
        root.innerHTML = '<div class="fx-scrim" data-act="scrim" style="--gc:' + gc(b) + '"><div class="fx-modal" role="dialog" aria-modal="true" aria-labelledby="fx-m-title">' +
            '<div class="fx-m-head"><div><p class="fx-eyebrow">' + esc(b.name) + " · " + esc(m.name) + '</p><h2 id="fx-m-title">Match #' + m.num + '</h2></div><button type="button" class="fx-icon-btn" data-act="close-modal" aria-label="Close">×</button></div>' +
            '<div class="fx-m-body">' + live + '<p class="fx-lbl">Who won? Score is optional.</p>' + pick(0) + pick(1) + '<div class="fx-m-warn" id="fx-m-warn" aria-live="polite">' + modalWarn() + "</div></div>" +
            '<div class="fx-m-foot">' + foot + "</div></div></div>";
    }
    function syncModal() {
        var M = ui.modal;
        if (!M || M.kind !== "match") { return; }
        [0, 1].forEach(function (i) {
            var btn = document.querySelector('.fx-pk[data-i="' + i + '"]');
            if (!btn) { return; }
            btn.classList.toggle("on", M.pick === i);
            btn.setAttribute("aria-pressed", String(M.pick === i));
            var mark = btn.querySelector(".fx-pk-mark");
            if (mark) { mark.textContent = M.pick === i ? "Winner" : "Won?"; }
        });
        var w = document.getElementById("fx-m-warn"); if (w) { w.innerHTML = modalWarn(); }
        var s = document.getElementById("fx-m-save"); if (s) { s.disabled = M.pick == null; }
    }
    function autoPick() {
        var M = ui.modal;
        if (M.manual) { return; }
        var a = toNum(M.s[0]), c = toNum(M.s[1]);
        if (a != null && c != null && a !== c) { M.pick = a > c ? 0 : 1; }
    }
    function saveResult() {
        var M = ui.modal;
        if (!M || M.pick == null) { return; }
        var b = byId(M.g), D = derive(b), o = D.out[M.id], m = D.st.M[M.id];
        var a = o.slots[0].p, c = o.slots[1].p, w = M.pick ? c : a;
        var sa = toNum(M.s[0]), sc = toNum(M.s[1]);
        var score = sa != null && sc != null ? " " + (M.pick ? sc + "–" + sa : sa + "–" + sc) : "";
        var msg = "Saved · " + D.P[w].name + " beat " + D.P[w === a ? c : a].name + score + " (#" + m.num + ")";
        var g = M.g, id = M.id;
        closeModal();
        op({ op: "result", game: g, matchId: id, winner: w, sa: sa, sb: sc }, msg);
    }
    function signin(key) {
        var btn = document.getElementById("fx-si-go");
        if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
        ui.key = key;
        admin("check", "POST").then(function () {
            lset("fusion.key", key);
            ui.to = true;
            ui.spectate = false;
            savePrefs();
            closeModal();
            loadPlayers();
            render();
            toast("Signed in. Organizer tools are on for this device.");
        }).catch(function (err) {
            ui.key = null;
            if (ui.modal && ui.modal.kind === "signin") {
                ui.modal.error = err.message || "Couldn't check the password.";
                renderModal();
                var inp = document.getElementById("fx-key");
                if (inp) { inp.focus(); }
            }
        });
    }

    // ---------- Toasts ----------
    function toast(msg, kind) {
        var root = document.getElementById("fx-toasts");
        if (!root) { return; }
        var el = document.createElement("div");
        el.className = "fx-toast" + (kind ? " " + kind : "");
        el.textContent = msg;
        root.appendChild(el);
        while (root.children.length > 4) { root.removeChild(root.firstChild); }
        setTimeout(function () {
            el.classList.add("out");
            setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 300);
        }, kind === "warn" ? 8000 : 5000);
    }

    // ---------- Render ----------
    var renderPending = false;
    function typingInApp() {
        var ae = document.activeElement;
        return !!(ae && app.contains(ae) && ae.matches && ae.matches("input:not([type=checkbox]), textarea, select"));
    }
    function scheduleRender() {
        if (typingInApp()) { renderPending = true; renderBig(); return; }
        render();
    }
    function render() {
        renderPending = false;
        if (!STATE) {
            app.innerHTML = '<div class="fx-head"><div><h1 class="section-title">Bracket</h1><p class="fx-sub">' +
                esc(ui.loadError ? "Can’t load the bracket right now. " + ui.loadError : "Loading the brackets…") + "</p></div></div>";
            return;
        }
        var sc = document.getElementById("bk-scroll");
        var keep = sc ? { x: sc.scrollLeft, y: sc.scrollTop, g: ui.game, v: ui.view } : null;
        app.innerHTML = headHTML() + tabsHTML() + gameHTML();
        if (keep && keep.g === ui.game && keep.v === ui.view) {
            var sc2 = document.getElementById("bk-scroll");
            if (sc2) { sc2.scrollLeft = keep.x; sc2.scrollTop = keep.y; }
        }
        renderBig();
    }
    function renderStatus() {
        var el = document.getElementById("fx-status");
        if (el) { el.innerHTML = statusHTML(); }
    }
    function tick() {
        var u = document.getElementById("fx-upd");
        if (u && STATE && STATE.updatedAt) { u.textContent = "Updated " + ago(STATE.updatedAt); }
        var c = document.getElementById("fx-bs-clock"); if (c) { c.textContent = clock(); }
        var bu = document.getElementById("fx-bs-upd"); if (bu && STATE && STATE.updatedAt) { bu.textContent = "Updated " + ago(STATE.updatedAt); }
    }
    app.addEventListener("focusout", function () {
        setTimeout(function () { if (renderPending && !typingInApp()) { render(); } }, 0);
    });

    // ---------- Organizer actions ----------
    function activeIds(g) { return byId(g).players.map(function (p) { return p.id; }); }
    function saveNames() {
        var inputs = Array.prototype.slice.call(app.querySelectorAll("input[id^='fx-pn-']"));
        var changes = inputs.map(function (inp) {
            return { pid: inp.getAttribute("data-pid"), was: inp.getAttribute("data-was"), tag: inp.value.replace(/\s+/g, " ").trim() };
        }).filter(function (c) { return c.tag !== c.was; });
        if (!changes.length) { toast("No tags changed."); return; }
        if (changes.some(function (c) { return c.tag.length < 2; })) { toast("Gamer tags need at least 2 characters.", "warn"); return; }
        var chain = Promise.resolve(true), done = 0;
        changes.forEach(function (c) {
            chain = chain.then(function (okSoFar) {
                if (!okSoFar) { return false; }
                return op({ op: "rename", playerId: c.pid, tag: c.tag }).then(function (r) { if (r) { done++; } return !!r; });
            });
        });
        chain.then(function () { if (done) { toast(done + " gamer tag" + (done > 1 ? "s" : "") + " updated."); } });
    }

    // ---------- Events ----------
    document.addEventListener("click", function (e) {
        var el = e.target.closest ? e.target.closest("[data-act]") : null;
        if (!el) { return; }
        var act = el.getAttribute("data-act");
        if (act === "scrim" && e.target !== el) { return; }
        var M = ui.modal, b = STATE ? cur() : null, g = el.getAttribute("data-g") || (b && b.id), pid = el.getAttribute("data-pid");
        switch (act) {
            case "game": ui.game = g; ui.confirm = null; savePrefs(); render(); break;
            case "view": ui.view = el.getAttribute("data-v"); savePrefs(); render(); break;
            case "zoom": {
                var zv = zoomVal(), i = 0;
                for (var k = 0; k < ZOOMS.length; k++) { if (Math.abs(ZOOMS[k] - zv) < Math.abs(ZOOMS[i] - zv)) { i = k; } }
                i = Math.max(0, Math.min(ZOOMS.length - 1, i + (+el.getAttribute("data-d"))));
                ui.zoom = ZOOMS[i]; savePrefs(); render(); break;
            }
            case "open": openModal(g, el.getAttribute("data-id")); break;
            case "close-modal": case "scrim": closeModal(); break;
            case "pick": if (M) { M.pick = +el.getAttribute("data-i"); M.manual = true; syncModal(); } break;
            case "sc": if (M) {
                var si = +el.getAttribute("data-i"), v = toNum(M.s[si]);
                v = Math.max(0, Math.min(99, (v == null ? 0 : v) + (+el.getAttribute("data-d"))));
                M.s[si] = String(v);
                var inp = document.getElementById("fx-msc-" + si); if (inp) { inp.value = M.s[si]; }
                autoPick(); syncModal();
            } break;
            case "save-result": saveResult(); break;
            case "go-live": if (M) {
                var setupInp = document.getElementById("fx-m-setup"), setup = setupInp ? setupInp.value.trim().slice(0, 12) : "";
                var gb = byId(M.g), GD = derive(gb), go = GD.out[M.id];
                var label = "#" + GD.st.M[M.id].num + " called" + (setup ? " to Setup " + setup : "") + ": " + GD.P[go.slots[0].p].name + " vs " + GD.P[go.slots[1].p].name;
                var lg = M.g, lid = M.id;
                closeModal();
                op({ op: "call", game: lg, matchId: lid, setup: setup }, label);
            } break;
            case "unlive": if (M) { var ug = M.g, uid = M.id; closeModal(); op({ op: "uncall", game: ug, matchId: uid }, "Back to waiting."); } break;
            case "clear-ask": if (M) { M.confirmClear = true; renderModal(); } break;
            case "clear-no": if (M) { M.confirmClear = false; renderModal(); } break;
            case "clear-yes": if (M) { var cg = M.g, cid = M.id; closeModal(); op({ op: "clear", game: cg, matchId: cid }, "Result cleared."); } break;
            case "big": enterBig(); break;
            case "big-exit": exitBig(); break;
            case "signin": openSignin(); break;
            case "signout": signOut(); toast("Signed out on this device."); break;
            case "toggle-to": ui.spectate = !ui.spectate; savePrefs(); if (!ui.spectate) { loadPlayers(); } render(); break;
            case "unfollow": delete ui.follow[g]; savePrefs(); render(); break;
            case "move": {
                var ids = activeIds(b.id), at = ids.indexOf(pid), to = at + (+el.getAttribute("data-d"));
                if (at < 0 || to < 0 || to >= ids.length) { break; }
                ids.splice(to, 0, ids.splice(at, 1)[0]);
                op({ op: "seed", game: b.id, order: ids });
                break;
            }
            case "shuffle": {
                var list = activeIds(b.id);
                for (var x = list.length - 1; x > 0; x--) { var r = Math.floor(Math.random() * (x + 1)), t = list[x]; list[x] = list[r]; list[r] = t; }
                op({ op: "seed", game: b.id, order: list }, "Seeds shuffled.");
                break;
            }
            case "signup-order": op({ op: "seed", game: b.id, order: [] }, "Back to sign-up order."); break;
            case "remove": op({ op: "remove", game: b.id, playerId: pid }, "Removed from " + b.name + ". Find them under Removed to put them back."); break;
            case "restore": op({ op: "restore", game: b.id, playerId: pid }, "Back in the bracket."); break;
            case "start-ask": ui.confirm = "start:" + b.id; render(); break;
            case "reopen-ask": ui.confirm = "reopen:" + b.id; render(); break;
            case "confirm-cancel": ui.confirm = null; render(); break;
            case "start-go": ui.confirm = null; op({ op: "start", game: b.id }, b.name + " bracket started. Sign-ups for it are closed."); break;
            case "reopen-go": ui.confirm = null; op({ op: "reopen", game: b.id }, b.name + " is back to sign-ups."); break;
            case "save-names": saveNames(); break;
        }
    });
    document.addEventListener("submit", function (e) {
        var form = e.target, kind = form.getAttribute && form.getAttribute("data-form");
        if (!kind) { return; }
        e.preventDefault();
        if (kind === "signin") {
            var key = document.getElementById("fx-key").value;
            if (key) { signin(key); }
        } else if (kind === "walkin") {
            var inp = document.getElementById("fx-walkin"), tag = inp.value.replace(/\s+/g, " ").trim();
            if (tag.length < 2) { toast("Gamer tags need at least 2 characters.", "warn"); return; }
            op({ op: "walkin", game: cur().id, tag: tag }, tag + " added to " + cur().name + ".").then(function (r) {
                var again = document.getElementById("fx-walkin");
                if (r && again) { again.value = ""; again.focus(); }
            });
        }
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { if (ui.modal) { closeModal(); } else if (ui.big) { exitBig(); } return; }
        if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("is-click")) {
            e.preventDefault();
            openModal(e.target.getAttribute("data-g"), e.target.getAttribute("data-id"));
        }
        if (e.key === "Enter" && e.target.id === "fx-m-setup") { e.preventDefault(); var go = document.querySelector('[data-act="go-live"]'); if (go) { go.click(); } }
    });
    document.addEventListener("input", function (e) {
        var t = e.target;
        if (t.id === "fx-msc-0" || t.id === "fx-msc-1") {
            var M = ui.modal; if (!M) { return; }
            var i = +t.id.slice(-1), clean = t.value.replace(/\D/g, "").slice(0, 2);
            if (clean !== t.value) { t.value = clean; }
            M.s[i] = clean; autoPick(); syncModal();
        } else if (t.id === "fx-m-setup" && ui.modal) { ui.modal.setup = t.value; }
    });
    document.addEventListener("change", function (e) {
        var t = e.target;
        if (t.hasAttribute("data-follow")) {
            var g = t.getAttribute("data-follow");
            if (t.value) { ui.follow[g] = t.value; } else { delete ui.follow[g]; }
            savePrefs(); render();
        } else if (t.hasAttribute("data-paid")) {
            op({ op: "paid", playerId: t.getAttribute("data-paid"), paid: t.checked }, t.checked ? "Marked as paid." : "Marked as not paid.").then(function (r) { if (!r) { render(); } });
        } else if (t.hasAttribute("data-reset")) {
            var rg = t.getAttribute("data-reset"), on = t.checked;
            op({ op: "reset", game: rg, on: on }, "Bracket reset turned " + (on ? "on." : "off.")).then(function (r) { if (!r) { render(); } });
        }
    });
    document.addEventListener("toggle", function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) { return; }
        if (t.hasAttribute("data-settings")) { ui.settingsOpen[t.getAttribute("data-settings")] = t.open; }
        if (t.hasAttribute("data-removed")) { ui.removedOpen[t.getAttribute("data-removed")] = t.open; }
    }, true);
    var lastNarrow = window.innerWidth < 600, resizeT = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeT);
        resizeT = setTimeout(function () {
            var n = window.innerWidth < 600;
            if (n !== lastNarrow && STATE && !typingInApp()) { lastNarrow = n; render(); }
        }, 200);
    });

    // ---------- Start ----------
    render();
    poll();
    setInterval(tick, 5000);
    if (ui.key) {
        admin("check", "POST").then(function () { ui.to = true; loadPlayers(); render(); }).catch(function (err) {
            if (err.status === 401) { ui.key = null; ldel("fusion.key"); }
        });
    }
})();
