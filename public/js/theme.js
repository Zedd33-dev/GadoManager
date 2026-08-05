// Applies the persisted theme choice before first paint (this file is loaded
// synchronously in <head>, not deferred, specifically so [data-theme] lands
// on <html> before the browser paints - avoiding a flash of the wrong theme).
// If the user has never chosen explicitly, no attribute is set and the
// prefers-color-scheme media query in app.css decides.
(function () {
  var STORAGE_KEY = 'gadomanager-theme';
  var stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // Storage may be unavailable (private browsing, disabled cookies). The
    // toggle still works for the current page load, it just won't persist.
  }
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.querySelector('[data-theme-toggle]');
    if (!button) return;

    button.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var currentlyDark = current === 'dark' || (!current && prefersDark);
      var next = currentlyDark ? 'light' : 'dark';

      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        // Nothing further to do - the reload below still picks up prefers-
        // color-scheme even if the explicit choice cannot be saved.
      }

      // A full reload, not just setAttribute() - every CSS-styled element
      // would restyle live either way, but a page with a Chart.js chart
      // (public/js/charts.js, animalChart.js) reads the theme's colours
      // once, at chart-creation time, and bakes them into the canvas.
      // Toggling the attribute alone left already-drawn chart text in
      // whichever colour was correct for the *previous* theme - readable
      // against neither background. Reloading is what re-runs that
      // one-time read under the new theme, on every page, without having
      // to teach each chart script how to repaint itself on a live toggle.
      location.reload();
    });
  });
})();
