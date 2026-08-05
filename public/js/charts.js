/**
 * Dashboard charts.
 *
 * Classic script (no bundler, no build step), loaded after the Chart.js UMD
 * bundle. Reads its data from a `<script type="application/json">` tag the
 * server already rendered - see `src/lib/safeJson.js` - so there is no extra
 * network round trip and no inline script, which keeps the CSP at
 * `script-src 'self'` with nothing relaxed.
 *
 * Every chart here has a real `<table>` counterpart in the HTML (see
 * `dashboard.ejs`) built from the exact same numbers. If this script does not
 * run - JavaScript disabled, a slow connection that never finishes loading it -
 * the table is still there and still correct; the chart is a visualisation of
 * data that already exists on the page, not the only place the data lives.
 */

(function () {
  'use strict';

  var dataEl = document.getElementById('chart-data');
  if (!dataEl || typeof Chart === 'undefined') return;

  var charts;
  try {
    charts = JSON.parse(dataEl.textContent);
  } catch (error) {
    return;
  }

  var numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  var currencyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var gmdFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // Same semantic palette as public/css/app.css, but read from the live CSS
  // custom properties rather than copied as fixed hex values. Chart.js draws
  // to a <canvas>, which cannot be styled or overridden by a CSS variable's
  // dark-mode value the way an HTML element can - a hardcoded copy of the
  // light-theme colours would leave every axis label, legend and tooltip
  // near-black on a dark card regardless of theme. Reading getComputedStyle
  // here picks up whichever value the cascade (prefers-color-scheme or the
  // manual [data-theme] override) actually resolved for this page load.
  var rootStyle = getComputedStyle(document.documentElement);
  function cssVar(name) {
    return rootStyle.getPropertyValue(name).trim();
  }

  var PALETTE = {
    success: cssVar('--color-success'),
    warning: cssVar('--color-warning'),
    danger: cssVar('--color-danger'),
    info: cssVar('--color-info'),
    text: cssVar('--color-text'),
    muted: cssVar('--color-text-muted'),
    border: cssVar('--color-border'),
  };

  var SERIES_COLORS = [PALETTE.info, PALETTE.success, PALETTE.warning, PALETTE.danger, PALETTE.muted];

  Chart.defaults.color = PALETTE.text;
  Chart.defaults.borderColor = PALETTE.border;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  /** Draws the herd total in the centre of the status donut. */
  var centerTextPlugin = {
    id: 'centerText',
    afterDraw: function (chart) {
      var config = chart.options.plugins && chart.options.plugins.centerText;
      if (!config || !config.text) return;

      var meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data[0]) return;

      var center = meta.data[0];
      var ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PALETTE.text;
      ctx.font = "700 1.5rem 'Segoe UI', sans-serif";
      ctx.fillText(config.text, center.x, center.y - 10);
      ctx.font = "400 0.8rem 'Segoe UI', sans-serif";
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText('animais', center.x, center.y + 14);
      ctx.restore();
    },
  };

  /** Draws a formatted value above each bar of a chart's first dataset. */
  function valueLabelPlugin(formatter) {
    return {
      id: 'valueLabels',
      afterDatasetsDraw: function (chart) {
        if (chart.config.type !== 'bar') return;
        var meta = chart.getDatasetMeta(0);
        if (!meta) return;

        var ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = PALETTE.text;
        ctx.textAlign = 'center';
        ctx.font = "600 0.75rem 'Segoe UI', sans-serif";
        meta.data.forEach(function (bar, index) {
          var value = chart.data.datasets[0].data[index];
          if (value === null || value === undefined) return;
          ctx.fillText(formatter(value), bar.x, bar.y - 6);
        });
        ctx.restore();
      },
    };
  }

  function percentLabel(value, total) {
    var pct = total > 0 ? (value / total) * 100 : 0;
    return pct.toFixed(1).replace('.', ',') + '%';
  }

  // --- Donut: Status do rebanho -----------------------------------------------
  (function renderHerdStatus() {
    var el = document.getElementById('chart-herd-status');
    var data = charts.herdStatus;
    if (!el || !data || data.total === 0) return;

    var colors = [PALETTE.success, PALETTE.info, PALETTE.danger, PALETTE.warning];

    new Chart(el, {
      type: 'doughnut',
      data: { labels: data.labels, datasets: [{ data: data.values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          centerText: { text: numberFormat.format(data.total) },
          legend: {
            position: 'bottom',
            labels: {
              generateLabels: function (chart) {
                return chart.data.labels.map(function (label, i) {
                  var value = chart.data.datasets[0].data[i];
                  return {
                    text: label + ': ' + numberFormat.format(value) + ' (' + percentLabel(value, data.total) + ')',
                    fillStyle: colors[i],
                    index: i,
                  };
                });
              },
            },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + numberFormat.format(ctx.parsed) + ' (' + percentLabel(ctx.parsed, data.total) + ')';
              },
            },
          },
        },
      },
      plugins: [centerTextPlugin],
    });
  })();

  // --- Bar: Peso médio por lote, with a herd-average reference line ----------
  (function renderWeightByLot() {
    var el = document.getElementById('chart-weight-by-lot');
    var data = charts.weightByLot;
    if (!el || !data || data.labels.length === 0) return;

    var datasets = [
      { label: 'Peso médio (kg)', data: data.values, backgroundColor: PALETTE.info, borderRadius: 4 },
    ];

    if (data.herdAverage !== null) {
      datasets.push({
        type: 'line',
        label: 'Média do rebanho',
        data: data.labels.map(function () { return data.herdAverage; }),
        borderColor: PALETTE.danger,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      });
    }

    new Chart(el, {
      type: 'bar',
      data: { labels: data.labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'kg' } } },
        plugins: {
          legend: { display: data.herdAverage !== null },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + numberFormat.format(ctx.parsed.y) + ' kg';
              },
            },
          },
        },
      },
      plugins: [valueLabelPlugin(function (v) { return numberFormat.format(v); })],
    });
  })();

  // --- Grouped bar: Composição do rebanho -------------------------------------
  (function renderHerdComposition() {
    var el = document.getElementById('chart-herd-composition');
    var data = charts.herdComposition;
    if (!el || !data || data.labels.length === 0) return;

    new Chart(el, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          { label: 'Machos', data: data.male, backgroundColor: PALETTE.info },
          { label: 'Fêmeas', data: data.female, backgroundColor: PALETTE.warning },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'animais' } } },
        plugins: { legend: { position: 'bottom' } },
      },
    });
  })();

  // --- Line: Evolução do peso médio -------------------------------------------
  (function renderWeightEvolution() {
    var el = document.getElementById('chart-weight-evolution');
    var data = charts.weightEvolution;
    if (!el || !data || data.series.length === 0) return;

    new Chart(el, {
      type: 'line',
      data: {
        labels: data.months,
        datasets: data.series.map(function (s, i) {
          return {
            label: s.lotName,
            data: s.data,
            borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
            backgroundColor: 'transparent',
            spanGaps: true,
            tension: 0.25,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { title: { display: true, text: 'kg' } } },
        plugins: { legend: { position: 'bottom' } },
      },
    });
  })();

  // --- Line: Curva de GMD ------------------------------------------------------
  (function renderGmdCurve() {
    var el = document.getElementById('chart-gmd-curve');
    var data = charts.gmdCurve;
    if (!el || !data || data.series.length === 0) return;

    new Chart(el, {
      type: 'line',
      data: {
        labels: data.months,
        datasets: data.series.map(function (s, i) {
          return {
            label: s.lotName,
            data: s.data,
            borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
            backgroundColor: 'transparent',
            spanGaps: true,
            tension: 0.25,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { title: { display: true, text: 'kg/dia' } } },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + gmdFormat.format(ctx.parsed.y) + ' kg/dia';
              },
            },
          },
        },
      },
    });
  })();

  // --- Stacked bar: Custos por categoria ---------------------------------------
  (function renderCostsByCategory() {
    var el = document.getElementById('chart-costs-by-category');
    var data = charts.costsByCategory;
    if (!el || !data || data.series.length === 0) return;

    new Chart(el, {
      type: 'bar',
      data: {
        labels: data.months,
        datasets: data.series.map(function (s, i) {
          return { label: s.name, data: s.data, backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, title: { display: true, text: 'R$' } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + currencyFormat.format(ctx.parsed.y);
              },
            },
          },
        },
      },
    });
  })();
})();
