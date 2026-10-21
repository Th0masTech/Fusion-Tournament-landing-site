// Sign-up form on the homepage: lists the games the organizers have set up, then sends
// the entry to /api/signup, which puts the gamer tag straight into each game picked.
(function () {
    var form = document.getElementById("signup");
    if (!form) {
        return;
    }
    var COLORS = ["pink", "cyan", "violet", "green", "amber", "orange"];
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var msg = document.getElementById("su-msg");
    var done = document.getElementById("signup-done");
    var submit = document.getElementById("su-submit");
    var box = document.getElementById("su-games");
    var field = function (id) { return document.getElementById(id); };

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function and(names) {
        return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    }
    function say(text, focusId) {
        msg.textContent = text || "";
        msg.hidden = !text;
        if (focusId) {
            field(focusId).focus();
        }
    }
    function showGames(html) {
        box.innerHTML = "<legend>Which tournaments?</legend>" + html;
    }

    // The games come from the organizers' list, so a new game shows up here as soon as it's added.
    function loadGames() {
        fetch("/api/state", { headers: { accept: "application/json" } })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (state) {
                var games = (state && state.brackets) || [];
                if (!games.length) {
                    showGames('<p class="games-note">No tournaments are open for sign-up yet. Check back soon.</p>');
                    return;
                }
                var checked = {};
                Array.prototype.forEach.call(box.querySelectorAll("input:checked"), function (b) { checked[b.value] = true; });
                showGames(games.map(function (g) {
                    var started = g.status === "live";
                    var color = COLORS.indexOf(g.color) >= 0 ? g.color : "pink";
                    return '<label class="game-opt' + (started ? " is-closed" : "") + '" data-game="' + esc(g.game) + '" style="--accent: var(--g-' + color + ')">' +
                        '<input type="checkbox" name="games" value="' + esc(g.game) + '"' + (started ? " disabled" : checked[g.game] ? " checked" : "") + ">" +
                        "<span>" + esc(g.name) + "</span>" +
                        (started ? '<em class="closed-note">Bracket started</em>' : "") + "</label>";
                }).join(""));
            })
            .catch(function () {
                showGames('<p class="games-note">Couldn’t load the tournaments. Refresh the page to try again.</p>');
            });
    }
    loadGames();

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        say("");
        var games = Array.prototype.map.call(form.querySelectorAll('input[name="games"]:checked'), function (b) { return b.value; });
        var data = {
            tag: field("su-tag").value.trim(),
            name: field("su-name").value.trim(),
            email: field("su-email").value.trim(),
            company: field("su-company").value,
            games: games
        };
        if (data.tag.length < 2) {
            return say("Enter a gamer tag (at least 2 characters).", "su-tag");
        }
        if (data.name.length < 2) {
            return say("Enter your real name.", "su-name");
        }
        if (!EMAIL.test(data.email)) {
            return say("Enter a valid email address.", "su-email");
        }
        if (!games.length) {
            return say("Pick at least one tournament.");
        }

        submit.disabled = true;
        submit.textContent = "Signing up…";
        fetch("/api/signup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
            })
            .then(function (res) {
                if (!res.ok) {
                    say(res.body.error || "That sign-up didn't go through. Try again.");
                    if (res.status === 409) {
                        loadGames();
                    }
                    return;
                }
                var names = (res.body.games || []).map(function (g) { return g.name; });
                var n = names.length;
                field("done-tag").textContent = data.tag;
                field("done-text").textContent = "You're on the " + and(names) + " bracket" + (n > 1 ? "s" : "") +
                    ". Last step: buy " + (n > 1 ? (n === 2 ? "two" : n) + " tickets, one per tournament," : "your ticket") + " so your spot counts.";
                form.hidden = true;
                done.hidden = false;
                done.focus();
            })
            .catch(function () {
                say("Couldn't reach the sign-up server. Check your connection, or email fusion@deets.technology.");
            })
            .then(function () {
                submit.disabled = false;
                submit.textContent = "Sign up";
            });
    });

    document.getElementById("signup-again").addEventListener("click", function () {
        form.reset();
        done.hidden = true;
        form.hidden = false;
        loadGames();
        field("su-tag").focus();
    });
})();
