/**
 * Toast dismissal.
 *
 * No inline event handler attributes anywhere in this project - the CSP is
 * `script-src 'self'` with nothing relaxed, and an inline `onclick="..."`
 * attribute is blocked by that policy in a real browser exactly like an
 * inline `<script>` block would be. Every interactive behaviour is wired up
 * from an external file such as this one instead.
 */

(function () {
  'use strict';

  document.querySelectorAll('.toast__close').forEach(function (button) {
    button.addEventListener('click', function () {
      var toast = button.closest('.toast');
      if (toast) toast.remove();
    });
  });

  // Auto-dismiss so a toast does not linger indefinitely if ignored. Kept
  // generous - long enough to read a full sentence, short enough not to
  // accumulate if several pages are visited quickly.
  document.querySelectorAll('.toast').forEach(function (toast) {
    setTimeout(function () {
      toast.remove();
    }, 6000);
  });
})();
