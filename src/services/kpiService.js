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
import {
  todayIso,
  addDays,
  startOfMonth,
  startOfNextMonth,
} from '../lib/dates.js';
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
 * @param {{today?: string}} [options] `today` is injectable so tests are not
 *   tied to the machine clock
 */
export function buildDashboardKpis(db, farmIds, options = {}) {
  const today = options.today ?? todayIso();

  const horizon = addDays(today, UPCOMING_WINDOW_DAYS);
  const staleCutoff = addDays(today, -STALE_WEIGHING_DAYS);
  const monthStart = startOfMonth(today);
  const monthEnd = startOfNextMonth(today);

  const statusCounts = countAnimalsByStatus(db, farmIds);
  const weight = latestWeightAverage(db, farmIds);
  const gain = averageDailyGain(db, farmIds);
  const alerts = healthAlertCounts(db, farmIds, today, horizon);
  const stale = animalsWithoutRecentWeighing(db, farmIds, staleCutoff);
  const cost = costTotalInRange(db, farmIds, monthStart, monthEnd);
  const structure = structureCounts(db, farmIds);

  return {
    reference: { today, horizon, staleCutoff, monthStart, monthEnd },

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
       * Centavos, or null when nothing was recorded this month.
       *
       * The distinction matters: `entryCount === 0` means no data and renders as
       * an em dash with a call to action, while entries that genuinely sum to
       * zero render as R$ 0,00.
       */
      value: cost.entryCount > 0 ? cost.totalCents : null,
      entryCount: cost.entryCount,
      emptyMessage: cost.entryCount === 0 ? 'Nenhum custo lançado neste mês.' : null,
      periodStart: monthStart,
      explanation: 'Soma dos custos lançados no mês corrente, dentro do escopo selecionado.',
    },

    structure: {
      farms: structure.farms,
      lots: structure.lots,
    },
  };
}
