/**
 * Auto-submits the dashboard filter form when a select changes.
 *
 * Progressive enhancement, not a requirement: the form's submit button is
 * never removed (see dashboard.ejs), so the filters work identically without
 * this script - only the auto-submit convenience is lost.
 *
 * This used to be an inline `onchange="this.form.submit()"` attribute on each
 * `<select>`. That was silently broken: the CSP is `script-src 'self'` with
 * no `unsafe-inline`, and inline event-handler attributes are blocked by that
 * policy the same as an inline `<script>` block. The filters still worked
 * because the submit button was always there as a fallback, but the
 * auto-submit itself never actually ran in a real browser. Found and fixed
 * in Phase 7 while auditing for exactly this kind of CSP/inline-script gap.
 */

(function () {
  'use strict';

  document.querySelectorAll('.filter-bar select').forEach(function (select) {
    select.addEventListener('change', function () {
      select.form.submit();
    });
  });
})();
