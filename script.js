// Load window at top
window.onload = function () {
    window.scrollTo(0, 0);
};

// Opens Navigation from the right
function openNav() {
    document.getElementById("mySidenav").classList.add("is-open");
    document.getElementById("bar").setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-open");
}

// Closes Navigation, sliding it out to the right
function closeNav() {
    document.getElementById("mySidenav").classList.remove("is-open");
    document.getElementById("bar").setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
}

document.addEventListener("DOMContentLoaded", function () {
    var header = document.getElementById("header");
    var heroLogo = document.querySelector(".hero-logo");
    var sidenav = document.getElementById("mySidenav");
    var menuButton = document.getElementById("bar");

    // Intro splash: plays once per visit. When the ball bursts into the logo, the
    // black melts away and the teaser's logo glides onto the site's logo.
    var splash = document.getElementById("splash");
    if (splash) {
        var root = document.documentElement;
        clearTimeout(window.splashFailsafe);
        if (!root.classList.contains("splash-on")) {
            splash.remove();
        } else {
            var film = splash.querySelector(".splash-video");
            var skip = splash.querySelector(".splash-skip");
            var REVEAL_AT = 8.7; // seconds into the clip where the burst starts
            var stage = "playing";
            var stallTimer;

            var endSplash = function (fast) {
                if (stage === "done") {
                    return;
                }
                stage = "done";
                clearTimeout(stallTimer);
                splash.classList.add(fast ? "skipping" : "revealing");
                root.classList.add("splash-done");
                if (fast) {
                    root.classList.add("splash-fast");
                }
                setTimeout(function () {
                    splash.remove();
                    root.classList.remove("splash-on");
                }, fast ? 450 : 2300);
            };

            // Where the teaser's logo sits in its 1920x1080 frame (centre, and the
            // box matching the site's logo image), so it can land on the real one
            var glideToLogo = function () {
                var target = document.querySelector(".hero-logo img").getBoundingClientRect();
                var vw = window.innerWidth;
                var vh = window.innerHeight;
                var cover = getComputedStyle(film).objectFit === "cover";
                var s = cover ? Math.max(vw / 1920, vh / 1080) : Math.min(vw / 1920, vh / 1080);
                var fw = 1920 * s;
                var fh = 1080 * s;
                var sx = (vw - fw) / 2 + 0.4995 * fw;
                var sy = (vh - fh) / 2 + 0.4981 * fh;
                var kx = target.width / (0.4067 * fw);
                var ky = target.height / (0.2949 * fh);
                var tx = target.left + target.width / 2;
                var ty = target.top + target.height / 2;
                film.style.transform = "translate(" + (tx - kx * sx) + "px, " + (ty - ky * sy) + "px) scale(" + kx + ", " + ky + ")";
            };

            var watchForBurst = function () {
                if (stage !== "playing") {
                    return;
                }
                if (film.currentTime >= REVEAL_AT) {
                    glideToLogo();
                    endSplash(false);
                    return;
                }
                requestAnimationFrame(watchForBurst);
            };

            try {
                sessionStorage.setItem("fusion-intro", "seen");
            } catch (e) {}

            skip.addEventListener("click", function () {
                endSplash(true);
            });
            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape") {
                    endSplash(true);
                }
            });
            film.addEventListener("playing", function () {
                clearTimeout(stallTimer);
                requestAnimationFrame(watchForBurst);
            });
            film.addEventListener("ended", function () {
                endSplash(false);
            });
            // Slow connection: if the intro can't get going or keeps buffering, go to the site
            film.addEventListener("waiting", function () {
                clearTimeout(stallTimer);
                stallTimer = setTimeout(function () {
                    endSplash(true);
                }, 2000);
            });
            setTimeout(function () {
                if (film.currentTime === 0) {
                    endSplash(true);
                }
            }, 2500);
            var attempt = film.play();
            if (attempt && attempt.catch) {
                attempt.catch(function () {
                    endSplash(true);
                });
            }
        }
    }

    // Header is see-through over the hero; it turns solid (with the small logo)
    // once the big hero logo has scrolled up out of view. Pages without a hero
    // (like Rules) keep it solid.
    var ticking = false;
    function updateHeader() {
        var logoGone = !heroLogo || heroLogo.getBoundingClientRect().bottom <= header.offsetHeight;
        header.classList.toggle("scrolled", logoGone);
        ticking = false;
    }
    updateHeader();
    window.addEventListener("scroll", function () {
        if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(updateHeader);
        }
    }, { passive: true });

    // Close the menu after picking a section, tapping outside it, or pressing Escape
    document.querySelectorAll("#navbar a").forEach(function (link) {
        link.addEventListener("click", closeNav);
    });
    document.addEventListener("click", function (event) {
        if (sidenav.classList.contains("is-open") &&
            !sidenav.contains(event.target) && !menuButton.contains(event.target)) {
            closeNav();
        }
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closeNav();
        }
    });

    // People who turn off motion get still frames; the gameplay videos wait for a tap to play
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.querySelectorAll("video[autoplay]").forEach(function (video) {
            video.removeAttribute("autoplay");
            video.pause();
        });
        document.querySelectorAll(".yt-embed").forEach(function (frame) {
            frame.src = frame.src.replace("autoplay=1", "autoplay=0");
        });
    }
});
