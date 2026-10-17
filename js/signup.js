// Sign-up form on the homepage: sends the entry to /api/signup, which puts the
// gamer tag straight into the bracket for each tournament picked.
(function () {
    var form = document.getElementById("signup");
    if (!form) {
        return;
    }
    var GAMES = { smash: "Smash Ultimate", fc: "FC 27" };
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var msg = document.getElementById("su-msg");
    var done = document.getElementById("signup-done");
    var submit = document.getElementById("su-submit");
    var field = function (id) { return document.getElementById(id); };

    function say(text, focusId) {
        msg.textContent = text || "";
        msg.hidden = !text;
        if (focusId) {
            field(focusId).focus();
        }
    }

    // A game whose bracket has started can't take new sign-ups.
    fetch("/api/state", { headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (state) {
            if (!state || !state.brackets) {
                return;
            }
            state.brackets.forEach(function (b) {
                var opt = form.querySelector('.game-opt[data-game="' + b.game + '"]');
                if (!opt) {
                    return;
                }
                var started = b.status === "live";
                var box = opt.querySelector("input");
                box.disabled = started;
                if (started) {
                    box.checked = false;
                }
                opt.classList.toggle("is-closed", started);
                opt.querySelector(".closed-note").hidden = !started;
            });
        })
        .catch(function () {});

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
                return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, body: body }; });
            })
            .then(function (res) {
                if (!res.ok) {
                    say(res.body.error || "That sign-up didn't go through. Try again.");
                    return;
                }
                var names = res.body.games.map(function (g) { return GAMES[g]; });
                field("done-tag").textContent = data.tag;
                field("done-text").textContent = "You're on the " + names.join(" and ") + " bracket" + (names.length > 1 ? "s" : "") +
                    ". Last step: buy " + (names.length > 1 ? "two tickets, one per tournament," : "your ticket") + " so your spot counts.";
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
        field("su-tag").focus();
    });
})();
