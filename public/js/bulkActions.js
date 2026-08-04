/**
 * Confirmation dialog and bulk-selection bar for the Animais list and detail
 * pages - the deferred Phase 7 component, finally with a real caller now
 * that a genuinely destructive action (permanent delete) exists.
 *
 * Uses the native `<dialog>` element rather than a hand-built modal: it is
 * keyboard-trappable and dismissible with Escape for free, and
 * `showModal()`/the `close` event cover everything a confirm dialog needs
 * without a component library.
 */

(function () {
  'use strict';

  const dialog = document.getElementById('confirm-delete-dialog');
  const messageEl = document.getElementById('confirm-delete-message');
  const confirmButton = document.getElementById('confirm-delete-button');
  if (!dialog || !confirmButton) return;

  const defaultMessage = messageEl.textContent;
  let pendingForm = null;

  function openDialogFor(form, message) {
    if (!form) return;
    pendingForm = form;
    messageEl.textContent = message || defaultMessage;
    dialog.showModal();
  }

  dialog.addEventListener('close', function () {
    if (dialog.returnValue === 'confirm' && pendingForm) {
      pendingForm.submit();
    }
    pendingForm = null;
  });

  // Any button marked data-confirm-delete opens the dialog for its own form -
  // used today by the single-record delete button on the animal detail page.
  document.querySelectorAll('[data-confirm-delete]').forEach(function (button) {
    button.addEventListener('click', function () {
      openDialogFor(button.closest('form'), button.getAttribute('data-confirm-message'));
    });
  });

  // The list page's bulk-selection bar.
  const bulkForm = document.getElementById('bulk-delete-form');
  const bulkBar = document.querySelector('.bulk-bar');
  const bulkDeleteButton = document.querySelector('.bulk-bar__delete');
  const bulkCount = document.querySelector('.bulk-bar__count');
  const selectAll = document.querySelector('.select-all');
  const rowSelects = document.querySelectorAll('.row-select');

  function updateBulkBar() {
    if (!bulkBar) return;
    const checked = document.querySelectorAll('.row-select:checked').length;
    bulkBar.hidden = checked === 0;
    if (bulkDeleteButton) bulkDeleteButton.disabled = checked === 0;
    if (bulkCount) bulkCount.textContent = `${checked} selecionado(s)`;
  }

  rowSelects.forEach(function (checkbox) {
    checkbox.addEventListener('change', updateBulkBar);
  });

  if (selectAll) {
    selectAll.addEventListener('change', function () {
      rowSelects.forEach(function (checkbox) {
        checkbox.checked = selectAll.checked;
      });
      updateBulkBar();
    });
  }

  if (bulkDeleteButton) {
    bulkDeleteButton.addEventListener('click', function () {
      const checked = document.querySelectorAll('.row-select:checked').length;
      openDialogFor(
        bulkForm,
        `${checked} animal(is) selecionado(s) será(ão) excluído(s) permanentemente, ` +
          'junto com todo o histórico de pesagens, sanidade e movimentações.',
      );
    });
  }

  updateBulkBar();
})();
