/**
 * Mobile navigation toggle.
 *
 * The nav and the user box are always present in the markup - this only
 * shows or hides them via a class, so the page is fully usable if this
 * script never loads (everything is just always visible, stacked, which is
 * exactly the desktop layout under `min-width` in app.css).
 */

(function () {
  'use strict';

  var toggle = document.querySelector('.nav-toggle');
  var bar = document.querySelector('.app-header__bar');
  if (!toggle || !bar) return;

  toggle.addEventListener('click', function () {
    var isOpen = bar.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
})();
