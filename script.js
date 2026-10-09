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

    // People who turn off motion get still frames; recaps keep controls so they can still play them
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.querySelectorAll("video[autoplay]").forEach(function (video) {
            video.removeAttribute("autoplay");
            video.pause();
            if (video.classList.contains("recap")) {
                video.controls = true;
            }
        });
    }
});
