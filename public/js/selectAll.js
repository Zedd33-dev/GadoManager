/**
 * "Select all" for the animal-picker tables on the protocol scheduling and
 * movement screens.
 *
 * Kept separate from bulkActions.js, which additionally drives a confirmation
 * dialog and a bulk bar that these screens do not have. Progressive
 * enhancement: every checkbox is a real form control, so without this file the
 * screens still work, one animal at a time.
 */

(function () {
  'use strict';

  const selectAll = document.querySelector('.select-all');
  const rowSelects = document.querySelectorAll('.row-select');
  if (!selectAll || rowSelects.length === 0) return;

  selectAll.addEventListener('change', function () {
    rowSelects.forEach(function (checkbox) {
      checkbox.checked = selectAll.checked;
    });
  });

  // Unticking one row should untick "select all", or the header checkbox ends
  // up claiming a selection that is no longer complete.
  rowSelects.forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      if (!checkbox.checked) selectAll.checked = false;
    });
  });
})();
