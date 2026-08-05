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

  // Read from the live CSS custom properties, not a hardcoded copy - see the
  // identical comment in public/js/charts.js. Without this, axis labels and
  // the tooltip stayed at Chart.js's own default grey regardless of theme,
  // which reads as "stuck in light mode" on a dark card.
  const rootStyle = getComputedStyle(document.documentElement);
  const textColor = rootStyle.getPropertyValue('--color-text').trim();
  const borderColor = rootStyle.getPropertyValue('--color-border').trim();
  const infoColor = rootStyle.getPropertyValue('--color-info').trim();

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = borderColor;

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Peso (kg)',
          data: data.values,
          borderColor: infoColor,
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
