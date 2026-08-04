/**
 * Keyboard-first enhancement for the batch weighing screen.
 *
 * Progressive enhancement only. The screen renders a fixed number of real
 * input rows server-side, so without this file it is still a completely
 * usable form - Tab already moves between fields and the submit button
 * already works. What this adds is the rhythm an operator wants on a
 * weighing day: type a weight, press Enter, and land on the next animal's
 * tag field without reaching for the mouse.
 */

(function () {
  'use strict';

  const form = document.querySelector('.batch-form');
  if (!form) return;

  const tagInputs = Array.from(form.querySelectorAll('.batch-input--tag'));
  const weightInputs = Array.from(form.querySelectorAll('.batch-input--weight'));
  if (tagInputs.length === 0) return;

  function focusRow(index) {
    if (index < tagInputs.length) {
      tagInputs[index].focus();
      tagInputs[index].select();
    }
  }

  weightInputs.forEach(function (input, index) {
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;

      // Enter in a weight field means "next animal", not "submit the form" -
      // an accidental early submit on a weighing day would be costly, since
      // the whole batch is all-or-nothing. The submit button stays the only
      // way to send.
      event.preventDefault();
      focusRow(index + 1);
    });
  });

  tagInputs.forEach(function (input, index) {
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      weightInputs[index].focus();
    });
  });

  // Land on the first empty tag field, so a re-presented form after a
  // validation failure continues where the operator left off rather than
  // making them scroll past rows they already filled.
  const firstEmpty = tagInputs.findIndex(function (input) {
    return input.value.trim() === '';
  });
  focusRow(firstEmpty === -1 ? 0 : firstEmpty);
})();
