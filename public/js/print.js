document.addEventListener('DOMContentLoaded', function () {
  var button = document.querySelector('[data-print-trigger]');
  if (!button) return;
  button.addEventListener('click', function () {
    window.print();
  });
});
