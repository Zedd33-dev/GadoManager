/**
 * The animal detail page's weight-curve chart.
 *
 * Same pattern as public/js/charts.js: data is read from a
 * <script type="application/json"> tag already rendered by the server, and a
 * real <table> beside the canvas carries the identical numbers, so nothing is
 * lost if this script never runs.
 */

(function () {
  'use strict';

  const dataEl = document.getElementById('animal-weight-data');
  const canvas = document.getElementById('chart-animal-weight');
  if (!dataEl || !canvas || typeof Chart === 'undefined') return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (error) {
    return;
  }
  if (!data.values || data.values.length === 0) return;

  const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Peso (kg)',
          data: data.values,
          borderColor: '#1f5673',
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { title: { display: true, text: 'kg' } } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${numberFormat.format(ctx.parsed.y)} kg`,
          },
        },
      },
    },
  });
})();
