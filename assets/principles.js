/* ============================================================
   Brad O'Haire portfolio - Principles page behavior
   Scoped to /principles. Progressive enhancement only: the page
   is fully usable with this file absent or disabled, because the
   five principle cards are native <details> disclosures and the
   index is plain anchor links.

   This file adds two things, both null-checked so it no-ops (with
   zero console errors) on every other page:
     1. a staggered scroll-reveal lift on the principle cards, on
        top of the shared .reveal handled by site.js;
     2. an active-state marker on the index that tracks which card
        is in view.

   Reduced motion: the staggered lift is skipped (cards shown at
   full strength); the index tracker still runs since it is not
   motion, only a state class.
   ============================================================ */
(function () {
  "use strict";

  // Bail entirely on any page without the principles list. This keeps the
  // file a clean no-op everywhere else and guarantees no stray errors.
  var list = document.getElementById("pr-list");
  if (!list) return;

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var cards = Array.prototype.slice.call(list.querySelectorAll("[data-pr]"));

  /* ---------- 1. Staggered per-card reveal ----------
     site.css gives each .pr-d an initial lift; adding .pr-in on the card
     drops it into place with a per-card delay (via --pr-i). Under reduced
     motion, or without IntersectionObserver, show every card at once. */
  if (cards.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      cards.forEach(function (card) {
        card.classList.add("pr-in");
      });
    } else {
      cards.forEach(function (card, i) {
        // cap the stagger so a long list never feels sluggish
        card.style.setProperty("--pr-i", String(Math.min(i, 6)));
      });
      var revealIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              en.target.classList.add("pr-in");
              revealIO.unobserve(en.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
      );
      cards.forEach(function (card) {
        revealIO.observe(card);
      });
    }
  }

  /* ---------- 2. Index active-state tracker ----------
     Each index link points at a card id; mark the link whose card is
     currently in view. Null-checked: links without a matching card are
     skipped, and the whole block no-ops if the index is absent. */
  var index = document.getElementById("pr-index");
  if (index && cards.length && "IntersectionObserver" in window) {
    var links = Array.prototype.slice.call(index.querySelectorAll("a[href^='#']"));

    // Build id -> link map, skipping any link without a real target card.
    var linkById = {};
    links.forEach(function (link) {
      var id = (link.getAttribute("href") || "").slice(1);
      if (id && document.getElementById(id)) {
        linkById[id] = link;
      }
    });

    function clearActive() {
      links.forEach(function (link) {
        link.classList.remove("is-active");
        link.removeAttribute("aria-current");
      });
    }

    var activeIO = new IntersectionObserver(
      function (entries) {
        // Pick the most-visible intersecting card this tick.
        var best = null;
        entries.forEach(function (en) {
          if (
            en.isIntersecting &&
            (!best || en.intersectionRatio > best.intersectionRatio)
          ) {
            best = en;
          }
        });
        if (!best) return;
        var link = linkById[best.target.id];
        if (!link) return;
        clearActive();
        link.classList.add("is-active");
        link.setAttribute("aria-current", "true");
      },
      { threshold: [0.25, 0.6], rootMargin: "-78px 0px -45% 0px" }
    );

    cards.forEach(function (card) {
      if (card.id && linkById[card.id]) {
        activeIO.observe(card);
      }
    });
  }
})();
