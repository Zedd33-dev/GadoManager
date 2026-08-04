/**
 * Dashboard KPI assembly.
 *
 * Takes the raw aggregates from `dashboardRepository` and turns them into a view
 * model. The rule applied consistently here: a KPI with no underlying data
 * carries `value: null` and an `emptyMessage`, never a zero. The view renders
 * `null` as an em dash.
 *
 * "No data" and "the answer is zero" are different facts about the herd and the
 * dashboard must not conflate them - that conflation is what makes a cost card
 * read R$ 0,00 when nothing was ever recorded.
 *
 * Each KPI also carries the denominator it was computed over, so the interface
 * can state the population in a tooltip rather than presenting an average whose
 * basis is invisible.
 */

import {
  countAnimalsByStatus,
  latestWeightAverage,
  averageDailyGain,
  healthAlertCounts,
  animalsWithoutRecentWeighing,
  costTotalInRange,
  structureCounts,
} from '../repositories/dashboardRepository.js';
import { todayIso, addDays } from '../lib/dates.js';
import { resolvePeriod } from '../lib/period.js';
import {
  UPCOMING_WINDOW_DAYS,
  STALE_WEIGHING_DAYS,
  MIN_WEIGHINGS_FOR_GMD,
} from '../domain/constants.js';

/**
 * Builds the full set of dashboard KPIs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds the caller's tenant scope
 * @param {{today?: string, lotId?: number|null, period?: {preset?: string, customFrom?: string, customUntil?: string}}} [options]
 *   `today` is injectable so tests are not tied to the machine clock. `lotId`
 *   narrows every KPI to one lote; `period` selects the range summed by the
 *   cost KPI and defaults to the current month, matching the figures every
 *   Phase 4 test was written against.
 *
 *   Weight and GMD are point-in-time "latest measurement" figures, not sums
 *   over a range, so `period` has nothing to narrow there - that is inherent
 *   to what those two KPIs measure, not an omission.
 */
export function buildDashboardKpis(db, farmIds, options = {}) {
  const today = options.today ?? todayIso();
  const lotId = options.lotId ?? null;
  const period = resolvePeriod(options.period ?? {}, today);

  const horizon = addDays(today, UPCOMING_WINDOW_DAYS);
  const staleCutoff = addDays(today, -STALE_WEIGHING_DAYS);

  const statusCounts = countAnimalsByStatus(db, farmIds, { lotId });
  const weight = latestWeightAverage(db, farmIds, { lotId });
  const gain = averageDailyGain(db, farmIds, { lotId });
  const alerts = healthAlertCounts(db, farmIds, today, horizon, { lotId });
  const stale = animalsWithoutRecentWeighing(db, farmIds, staleCutoff, { lotId });
  const cost = costTotalInRange(db, farmIds, period.from, period.until, { lotId });
  const structure = structureCounts(db, farmIds);

  return {
    reference: { today, horizon, staleCutoff, lotId, period },

    herd: {
      total: statusCounts.total,
      active: statusCounts.ativo,
      sold: statusCounts.vendido,
      dead: statusCounts.morto,
      transferred: statusCounts.transferido,
      isEmpty: statusCounts.total === 0,
    },

    averageWeight: {
      /** Kilograms, or null when no active animal has ever been weighed. */
      value: weight.animalCount > 0 ? weight.averageKg : null,
      animalCount: weight.animalCount,
      emptyMessage:
        weight.animalCount === 0 ? 'Nenhuma pesagem registrada para animais ativos.' : null,
      explanation:
        'Média do peso da pesagem mais recente de cada animal ativo. ' +
        `Considera ${weight.animalCount} animal(is) com ao menos uma pesagem.`,
    },

    averageDailyGain: {
      /** Kilograms per day, or null when no animal has two weighings. */
      value: gain.animalCount > 0 ? gain.averageKgPerDay : null,
      animalCount: gain.animalCount,
      emptyMessage:
        gain.animalCount === 0
          ? 'Nenhum animal ativo possui duas pesagens — o GMD não pode ser calculado.'
          : null,
      explanation:
        'GMD = (peso mais recente − peso anterior) ÷ dias entre as duas pesagens. ' +
        `A média considera apenas animais ativos com pelo menos ${MIN_WEIGHINGS_FOR_GMD} pesagens ` +
        `(${gain.animalCount} animal(is)). Animais com uma única pesagem são excluídos do cálculo, ` +
        'não contados como zero.',
    },

    healthAlerts: {
      overdueVaccineDoses: alerts.overdueVaccineDoses,
      overdueTreatmentDoses: alerts.overdueTreatmentDoses,
      overdueTotalDoses: alerts.overdueVaccineDoses + alerts.overdueTreatmentDoses,
      overdueAnimals: alerts.overdueAnimals,
      overdueVaccineAnimals: alerts.overdueVaccineAnimals,
      overdueTreatmentAnimals: alerts.overdueTreatmentAnimals,
      dueSoonDoses: alerts.dueSoonDoses,
      dueSoonAnimals: alerts.dueSoonAnimals,
      windowDays: UPCOMING_WINDOW_DAYS,
      hasAny: alerts.overdueVaccineDoses + alerts.overdueTreatmentDoses + alerts.dueSoonDoses > 0,
      explanation:
        'Uma dose está atrasada quando a data prevista já passou, ainda não foi aplicada ' +
        'e o animal continua ativo. Animais vendidos, mortos ou transferidos nunca geram alertas.',
    },

    withoutRecentWeighing: {
      value: stale.total,
      neverWeighed: stale.neverWeighed,
      overdueCycle: stale.total - stale.neverWeighed,
      windowDays: STALE_WEIGHING_DAYS,
      explanation:
        `Animais ativos sem pesagem nos últimos ${STALE_WEIGHING_DAYS} dias, ` +
        'incluindo os que nunca foram pesados.',
    },

    monthlyCost: {
      /**
       * Centavos, or null when nothing was recorded in the selected period.
       *
       * The distinction matters: `entryCount === 0` means no data and renders as
       * an em dash with a call to action, while entries that genuinely sum to
       * zero render as R$ 0,00.
       */
      value: cost.entryCount > 0 ? cost.totalCents : null,
      entryCount: cost.entryCount,
      emptyMessage: cost.entryCount === 0 ? 'Nenhum custo lançado no período selecionado.' : null,
      periodStart: period.from,
      periodEnd: period.until,
      periodLabel: period.label,
      explanation:
        lotId === null
          ? 'Soma dos custos lançados no período selecionado, dentro do escopo da fazenda.'
          : 'Soma dos custos lançados diretamente a este lote no período selecionado. ' +
            'Custos gerais da fazenda não são incluídos.',
    },

    structure: {
      farms: structure.farms,
      lots: structure.lots,
    },
  };
}
