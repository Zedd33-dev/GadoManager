/**
 * Demo dataset.
 *
 * Builds a herd that tells a coherent story: a breeding and rearing operation
 * (Fazenda Boa Vista, MS) that sends its young stock to a finishing operation
 * (Fazenda Santa Clara, MT), across eighteen months of weighings, movements,
 * sales, deaths and monthly costs.
 *
 * The dataset is deliberately shaped to exercise the rules the dashboard has to
 * get right:
 *
 *   - Some animals have exactly one weighing, so the GMD average has something
 *     it must exclude rather than count as zero.
 *   - Some animals have no weighing at all, so the "sem pesagem" card has a
 *     real population.
 *   - Sold and dead animals stop being weighed on their exit date, so any query
 *     that forgets to filter by status produces visibly wrong numbers.
 *   - The dry season depresses gain, so the GMD curve has a shape worth charting.
 *
 * Deliberately NOT seeded yet: the sanitary calendar (vaccines and treatments).
 * That is pending confirmation of the protocol list and the farms' states, since
 * a vaccination schedule invented for a thesis would be indefensible.
 *
 * Usage:  npm run seed
 */

import { getDb, closeDb } from '../src/config/db.js';
import { isProduction } from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';
import { todayIso, addDays, addMonths, daysBetween, startOfMonth } from '../src/lib/dates.js';
import { createGenerator } from './lib/random.js';
import { buildWeightCurve } from './lib/growth.js';
import { SEED_BREED_LABELS } from '../src/domain/constants.js';

/** Fixed seed: `npm run seed` must produce the same herd every time. */
const SEED = 20260803;

/** Shared password for every demo account. Documented in the README. */
const DEMO_PASSWORD = 'Gado@2026';

const TODAY = todayIso();
const SIMULATION_START = addMonths(TODAY, -18);
const NOW_TIMESTAMP = new Date().toISOString();

const gen = createGenerator(SEED);

// ---------------------------------------------------------------------------
// Static definitions
// ---------------------------------------------------------------------------

const FARMS = [
  {
    key: 'boaVista',
    name: 'Fazenda Boa Vista',
    city: 'Campo Grande',
    state: 'MS',
    // Total area exceeds the grazing area: a real property also carries legal
    // reserve, buildings and roads.
    totalAreaHa: 96,
    tagPrefix: 'BV',
  },
  {
    key: 'santaClara',
    name: 'Fazenda Santa Clara',
    city: 'Rondonópolis',
    state: 'MT',
    totalAreaHa: 22,
    tagPrefix: 'SC',
  },
];

/**
 * Pasture areas are sized against the herd that actually grazes them, so the
 * resulting UA/ha lands in the real Brazilian range (roughly 0.8-1.5 UA/ha on
 * managed pasture) rather than the implausibly low figure that generous
 * hectares over 130 head would produce.
 *
 * `maxStockingRateUaHa` varies by forage on purpose: Panicum maximum cv.
 * Mombaça carries appreciably more than Brachiaria decumbens. Pasto Fundo is
 * deliberately sized to sit *above* its capacity, so the overgrazing warning
 * is demonstrable with the shipped dataset instead of being a feature nobody
 * can see working.
 *
 * These capacities are PROVISIONAL - see the note on
 * PROVISIONAL_STOCKING_CAPACITY_UA_HA in src/domain/constants.js.
 */
const PASTURES = [
  { farm: 'boaVista', name: 'Pasto Sede', areaHa: 18, forage: 'Brachiaria brizantha cv. Marandu', restDays: 30, capacity: 1.3 },
  { farm: 'boaVista', name: 'Pasto Baixada', areaHa: 20, forage: 'Panicum maximum cv. Mombaça', restDays: 35, capacity: 1.6 },
  { farm: 'boaVista', name: 'Pasto Fundo', areaHa: 26, forage: 'Brachiaria decumbens', restDays: 28, capacity: 1.0 },
  { farm: 'santaClara', name: 'Pasto do Cocho', areaHa: 13, forage: 'Brachiaria brizantha cv. Marandu', restDays: 21, capacity: 1.5 },
];

const LOTS = [
  { farm: 'boaVista', name: 'Matrizes', description: 'Vacas de cria' },
  { farm: 'boaVista', name: 'Bezerros 2025', description: 'Bezerros do último parto' },
  { farm: 'boaVista', name: 'Recria Machos', description: 'Machos em recria' },
  { farm: 'boaVista', name: 'Recria Fêmeas', description: 'Fêmeas de reposição' },
  { farm: 'santaClara', name: 'Engorda A', description: 'Terminação — cruzados' },
  { farm: 'santaClara', name: 'Engorda B', description: 'Terminação — nelore' },
];

const USERS = [
  { name: 'Ana Souza', email: 'admin@gadomanager.com.br', role: 'admin', farms: ['boaVista', 'santaClara'] },
  { name: 'Carlos Menezes', email: 'gerente@boavista.com.br', role: 'gerente', farms: ['boaVista'] },
  { name: 'Marina Alves', email: 'gerente@santaclara.com.br', role: 'gerente', farms: ['santaClara'] },
  { name: 'José Bento', email: 'peao@boavista.com.br', role: 'peao', farms: ['boaVista'] },
];

/**
 * Cohorts. Ages are expressed in months before today so the dataset stays
 * plausible whenever it is regenerated.
 */
const COHORTS = [
  { lot: 'Matrizes', farm: 'boaVista', count: 25, sex: 'F', ageMonths: [60, 96], finishing: false,
    breeds: [['nelore', 7], ['cruzado', 3]], purchasedRate: 0.3 },
  { lot: 'Bezerros 2025', farm: 'boaVista', count: 30, sex: null, ageMonths: [9, 12], finishing: false,
    breeds: [['nelore', 6], ['cruzado', 4]], purchasedRate: 0 },
  { lot: 'Recria Machos', farm: 'boaVista', count: 25, sex: 'M', ageMonths: [19, 26], finishing: false,
    breeds: [['nelore', 6], ['cruzado', 4]], purchasedRate: 0 },
  { lot: 'Recria Fêmeas', farm: 'boaVista', count: 20, sex: 'F', ageMonths: [19, 26], finishing: false,
    breeds: [['nelore', 7], ['cruzado', 3]], purchasedRate: 0 },
  // Finishing ages follow real slaughter windows: crossbred and Angus animals
  // finish earlier than Nelore, which is the commercial reason for the cross.
  { lot: 'Engorda A', farm: 'santaClara', count: 18, sex: 'M', ageMonths: [20, 27], finishing: true,
    breeds: [['cruzado', 6], ['angus', 4]], purchasedRate: 0.45 },
  { lot: 'Engorda B', farm: 'santaClara', count: 12, sex: 'M', ageMonths: [24, 31], finishing: true,
    breeds: [['nelore', 9], ['cruzado', 1]], purchasedRate: 0.7 },
];

const SALE_EVENTS = [
  { date: addDays(addMonths(TODAY, -5), 9), buyer: 'Frigorífico Boi Forte', pricePerArroba: 31200, count: 5 },
  { date: addDays(addMonths(TODAY, -3), -6), buyer: 'Frigorífico Boi Forte', pricePerArroba: 29800, count: 4 },
  { date: addDays(addMonths(TODAY, -1), 11), buyer: 'Marfrig Rondonópolis', pricePerArroba: 32500, count: 3 },
];

const DEATH_CAUSES = ['doenca', 'acidente', 'predador', 'desconhecida'];

/**
 * PROVISIONAL sanitary calendar - confirm against the thesis references.
 *
 * These are protocol *rows*, not rules in the code: they are seeded so the
 * Vacinas, Tratamentos and carência screens have something to show, and are
 * fully editable through `/protocolos` without touching source.
 *
 * The list deliberately omits febre aftosa. Brazil was recognised free of
 * foot-and-mouth disease *without vaccination* in 2025, so a routine aftosa
 * campaign in a 2026 dataset would be an anachronism an examiner could catch.
 * What remains is brucelose (mandatory for females aged 3-8 months),
 * clostridioses, raiva, and vermifugação as a treatment.
 *
 * The withdrawal periods are plausible label values, not measurements.
 */
const HEALTH_PROTOCOLS = [
  {
    name: 'Brucelose (B19)',
    kind: 'vacina',
    product: 'Vacina B19',
    dose: 2,
    doseUnit: 'ml',
    withdrawalDays: 0,
    scheduleMode: 'por_idade',
    ageDays: 120,
    intervalDays: null,
    // Legally restricted to females in the 3-8 month window.
    appliesTo: (spec) => spec.sex === 'F',
  },
  {
    name: 'Clostridioses (polivalente)',
    kind: 'vacina',
    product: 'Vacina polivalente',
    dose: 5,
    doseUnit: 'ml',
    withdrawalDays: 21,
    scheduleMode: 'por_idade',
    ageDays: 150,
    intervalDays: 30,
    appliesTo: () => true,
  },
  {
    name: 'Raiva dos herbívoros',
    kind: 'vacina',
    product: 'Vacina antirrábica',
    dose: 2,
    doseUnit: 'ml',
    withdrawalDays: 0,
    scheduleMode: 'por_idade',
    ageDays: 240,
    intervalDays: null,
    appliesTo: () => true,
  },
  {
    name: 'Vermifugação',
    kind: 'tratamento',
    product: 'Ivermectina 1%',
    dose: 5,
    doseUnit: 'ml',
    withdrawalDays: 35,
    scheduleMode: 'por_idade',
    ageDays: 210,
    intervalDays: 180,
    appliesTo: () => true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clears every domain table. Children first, so foreign keys stay satisfied. */
function reset(db) {
  const tables = [
    'sale_items', 'sales', 'deaths', 'costs', 'reminders',
    'health_events', 'health_protocols', 'movements', 'weighings',
    'animals', 'lots', 'pastures', 'user_farms', 'users', 'farms',
  ];

  for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();

  // Restart autoincrement counters so ids are stable between runs.
  db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('cost_categories')").run();
}

/** Random ISO date between two ISO bounds, inclusive. */
function randomDateBetween(startIso, endIso) {
  const span = daysBetween(startIso, endIso);
  return addDays(startIso, gen.int(0, Math.max(span, 0)));
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

function insertFarms(db) {
  const statement = db.prepare(
    `INSERT INTO farms (name, city, state, total_area_ha, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const ids = {};
  for (const farm of FARMS) {
    ids[farm.key] = Number(
      statement.run(farm.name, farm.city, farm.state, farm.totalAreaHa, NOW_TIMESTAMP, NOW_TIMESTAMP)
        .lastInsertRowid,
    );
  }
  return ids;
}

function insertStructure(db, farmIds) {
  const pastureStatement = db.prepare(
    `INSERT INTO pastures
       (farm_id, name, area_ha, forage_type, rest_period_days,
        max_stocking_rate_ua_ha, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const lotStatement = db.prepare(
    `INSERT INTO lots (farm_id, name, description, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  );

  const pastureIds = {};
  for (const pasture of PASTURES) {
    pastureIds[pasture.name] = Number(
      pastureStatement.run(
        farmIds[pasture.farm], pasture.name, pasture.areaHa,
        pasture.forage, pasture.restDays, pasture.capacity,
        NOW_TIMESTAMP, NOW_TIMESTAMP,
      ).lastInsertRowid,
    );
  }

  const lotIds = {};
  for (const lot of LOTS) {
    lotIds[lot.name] = Number(
      lotStatement.run(farmIds[lot.farm], lot.name, lot.description, NOW_TIMESTAMP, NOW_TIMESTAMP)
        .lastInsertRowid,
    );
  }

  return { pastureIds, lotIds };
}

/**
 * Builds the animal specifications in memory before any of them is inserted,
 * so that exits (sales, deaths, transfers) can be assigned across the whole herd.
 */
function buildAnimalSpecs() {
  const specs = [];
  const tagCounters = { BV: 0, SC: 0 };

  for (const cohort of COHORTS) {
    const farm = FARMS.find((f) => f.key === cohort.farm);

    for (let i = 0; i < cohort.count; i += 1) {
      const ageMonths = gen.int(cohort.ageMonths[0], cohort.ageMonths[1]);
      const birthDate = addDays(addMonths(TODAY, -ageMonths), gen.int(-14, 14));
      const breed = gen.pickWeighted(cohort.breeds);
      const sex = cohort.sex ?? gen.pick(['M', 'F']);
      const purchased = gen.chance(cohort.purchasedRate);

      tagCounters[farm.tagPrefix] += 1;

      specs.push({
        farmKey: cohort.farm,
        lotName: cohort.lot,
        earTag: `${farm.tagPrefix}-${String(tagCounters[farm.tagPrefix]).padStart(4, '0')}`,
        birthDate,
        breed,
        sex,
        origin: purchased ? 'comprado' : 'nascido',
        purchaseDate: purchased ? randomDateBetween(addMonths(birthDate, 8), TODAY) : null,
        purchasePriceCents: purchased ? gen.int(180000, 420000) : null,
        isFinishing: cohort.finishing,
        individualFactor: Math.min(1.2, Math.max(0.78, gen.gaussian(1, 0.1))),
        // SISBOV is optional in practice; only part of the herd carries one.
        sisbov: gen.chance(0.35)
          ? `105${String(gen.int(100000000, 999999999))}`
          : null,
        status: 'ativo',
        exitDate: null,
        exitType: null,
        skipWeighings: false,
      });
    }
  }

  return specs;
}

/**
 * Attaches a simulated weight curve to every animal.
 *
 * Runs before exits are assigned, because choosing which animals to sell
 * requires knowing what each one weighed on the sale date.
 */
function attachCurves(specs) {
  for (const spec of specs) {
    spec.curve = buildWeightCurve(spec, TODAY);
  }
}

/**
 * Assigns sales, deaths and transfers across the herd.
 *
 * Sales are drawn only from the finishing lots, and within those the heaviest
 * animals go first. That is how the operation actually works: cattle are shipped
 * when they reach slaughter weight, not at random. Selecting randomly produced
 * 380 kg animals at the abattoir, which no buyer would accept.
 */
function assignExits(specs) {
  const finishing = specs.filter((s) => s.isFinishing);
  const sales = [];

  for (const event of SALE_EVENTS) {
    const readyForSlaughter = finishing
      .filter((s) => s.status === 'ativo')
      .map((s) => ({ spec: s, weight: s.curve.weightOn(event.date) ?? 0 }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, event.count);

    const animals = [];
    for (const { spec } of readyForSlaughter) {
      spec.status = 'vendido';
      spec.exitDate = event.date;
      spec.exitType = 'venda';
      animals.push(spec);
    }

    sales.push({ ...event, animals });
  }

  // Deaths, drawn from animals still active.
  const active = gen.shuffle(specs.filter((s) => s.status === 'ativo'));
  const deaths = [];

  for (let i = 0; i < 4; i += 1) {
    const spec = active[i];
    spec.status = 'morto';
    spec.exitDate = randomDateBetween(SIMULATION_START, addDays(TODAY, -20));
    spec.exitType = 'morte';
    deaths.push({ spec, cause: gen.pick(DEATH_CAUSES) });
  }

  // Two animals left the managed herd without being sold.
  for (let i = 4; i < 6; i += 1) {
    const spec = active[i];
    spec.status = 'transferido';
    spec.exitDate = randomDateBetween(SIMULATION_START, addDays(TODAY, -30));
    spec.exitType = 'transferencia';
  }

  // Three recently purchased animals that have not been weighed yet, so the
  // "sem pesagem" card has a genuine population rather than an empty one.
  for (let i = 6; i < 9; i += 1) {
    active[i].skipWeighings = true;
    active[i].origin = 'comprado';
    active[i].purchaseDate = randomDateBetween(addDays(TODAY, -40), addDays(TODAY, -5));
    active[i].purchasePriceCents = gen.int(200000, 450000);
  }

  return { sales, deaths };
}

function insertAnimals(db, specs, farmIds, lotIds, pastureIds) {
  const statement = db.prepare(
    `INSERT INTO animals
       (farm_id, ear_tag, sisbov, birth_date, sex, breed, origin, mother_id,
        purchase_date, purchase_price_cents, lot_id, pasture_id, status, notes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const pasturesByFarm = {
    boaVista: ['Pasto Sede', 'Pasto Baixada', 'Pasto Fundo'],
    santaClara: ['Pasto do Cocho'],
  };

  // Insert breeding females first so that calves can reference a real dam.
  const ordered = [
    ...specs.filter((s) => s.lotName === 'Matrizes'),
    ...specs.filter((s) => s.lotName !== 'Matrizes'),
  ];

  const motherIds = [];

  for (const spec of ordered) {
    // A calf born on the farm gets a dam from the breeding lot, when one exists
    // that is old enough to plausibly be its mother.
    const motherId =
      spec.lotName === 'Bezerros 2025' && spec.origin === 'nascido' && motherIds.length > 0
        ? gen.pick(motherIds)
        : null;

    const id = Number(
      statement.run(
        farmIds[spec.farmKey],
        spec.earTag,
        spec.sisbov,
        spec.birthDate,
        spec.sex,
        // The animal's own breed field is free text (migration 005); the
        // generator still picks by slug internally for the weighted-cohort
        // and carcass-yield logic below, so only the stored value converts.
        SEED_BREED_LABELS[spec.breed] ?? spec.breed,
        spec.origin,
        motherId,
        spec.purchaseDate,
        spec.purchasePriceCents,
        lotIds[spec.lotName],
        pastureIds[gen.pick(pasturesByFarm[spec.farmKey])],
        spec.status,
        null,
        NOW_TIMESTAMP,
        NOW_TIMESTAMP,
      ).lastInsertRowid,
    );

    spec.id = id;
    if (spec.lotName === 'Matrizes') motherIds.push(id);
  }
}

/**
 * Generates weighing records by sampling each animal's simulated curve.
 *
 * Weighing stops on the animal's exit date, so a sold or dead animal has no
 * records after it left the herd. Any dashboard query that forgets to filter by
 * status therefore produces visibly wrong numbers rather than plausible ones.
 */
function insertWeighings(db, specs, userIds) {
  const statement = db.prepare(
    `INSERT INTO weighings (animal_id, weigh_date, weight_kg, source, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const recorders = [userIds['peao@boavista.com.br'], userIds['gerente@boavista.com.br']];
  let total = 0;

  for (const spec of specs) {
    const lastDate = spec.exitDate ?? TODAY;
    const curve = spec.curve;

    if (spec.skipWeighings) continue;

    // Weighing begins at weaning, or at the start of the simulated window for
    // animals that were already grown when the records begin.
    const weaning = addDays(spec.birthDate, 210);
    let date = weaning > SIMULATION_START ? weaning : SIMULATION_START;

    while (date <= lastDate) {
      const weight = curve.weightOn(date);

      if (weight !== null) {
        // Scales are read to the nearest half kilo, and there is always a
        // little measurement noise.
        const measured = Math.round(weight * gen.float(0.985, 1.015) * 2) / 2;

        statement.run(
          spec.id,
          date,
          measured,
          gen.chance(0.8) ? 'lote' : 'manual',
          gen.pick(recorders),
          NOW_TIMESTAMP,
        );
        total += 1;
      }

      // Weighing day happens roughly every two to three months.
      date = addDays(date, gen.int(60, 90));
    }
  }

  return total;
}

function insertSales(db, sales, farmIds, userIds) {
  const saleStatement = db.prepare(
    `INSERT INTO sales (farm_id, buyer_name, sale_date, price_per_arroba_cents, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const itemStatement = db.prepare(
    `INSERT INTO sale_items
       (sale_id, animal_id, live_weight_kg, carcass_yield_pct, arrobas, gross_value_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let itemCount = 0;

  for (const sale of sales) {
    if (sale.animals.length === 0) continue;

    const saleId = Number(
      saleStatement.run(
        farmIds.santaClara,
        sale.buyer,
        sale.date,
        sale.pricePerArroba,
        null,
        userIds['gerente@santaclara.com.br'],
        NOW_TIMESTAMP,
        NOW_TIMESTAMP,
      ).lastInsertRowid,
    );

    for (const spec of sale.animals) {
      // The sale weight is a scale reading like any other, so it carries the
      // same measurement noise. Without it, animals that have converged on the
      // same growth asymptote all ship at an identical, implausible weight.
      const simulated = spec.curve.weightOn(sale.date) ?? spec.curve.finalWeight;
      const liveWeight = Math.round(simulated * gen.float(0.985, 1.015) * 2) / 2;

      // Carcass yield: the proportion of live weight that becomes carcass.
      // Nelore sits a little lower than crossbred and Angus animals.
      const yieldPct =
        spec.breed === 'nelore' ? gen.float(51.5, 54.0) : gen.float(53.0, 56.5);
      const roundedYield = Math.round(yieldPct * 10) / 10;

      // 1 arroba = 15 kg of carcass, so arrobas are computed on carcass weight,
      // not live weight. See docs/business-rules.md.
      const arrobas = Math.round(((liveWeight * roundedYield) / 100 / 15) * 100) / 100;
      const grossValue = Math.round(arrobas * sale.pricePerArroba);

      itemStatement.run(saleId, spec.id, liveWeight, roundedYield, arrobas, grossValue, NOW_TIMESTAMP);
      itemCount += 1;
    }
  }

  return itemCount;
}

function insertDeaths(db, deaths, userIds) {
  const statement = db.prepare(
    `INSERT INTO deaths (animal_id, death_date, cause, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const { spec, cause } of deaths) {
    statement.run(
      spec.id,
      spec.exitDate,
      cause,
      cause === 'desconhecida' ? 'Encontrado morto no pasto.' : null,
      userIds['gerente@boavista.com.br'],
      NOW_TIMESTAMP,
    );
  }

  return deaths.length;
}

/**
 * Records pasture rotation and the transfer of finished stock between farms.
 */
function insertMovements(db, specs, farmIds, lotIds, pastureIds, userIds) {
  const statement = db.prepare(
    `INSERT INTO movements
       (animal_id, moved_at, from_farm_id, to_farm_id, from_lot_id, to_lot_id,
        from_pasture_id, to_pasture_id, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const boaVistaPastures = ['Pasto Sede', 'Pasto Baixada', 'Pasto Fundo'];
  let total = 0;

  for (const spec of specs) {
    const lastDate = spec.exitDate ?? TODAY;

    // Finished animals born at Boa Vista were moved to Santa Clara for
    // finishing. This is the story the two farms exist to tell.
    if (spec.isFinishing && spec.origin === 'nascido') {
      const transferDate = addMonths(spec.birthDate, 19);

      if (transferDate < lastDate && transferDate > SIMULATION_START) {
        statement.run(
          spec.id, `${transferDate}T09:00:00.000Z`,
          farmIds.boaVista, farmIds.santaClara,
          lotIds['Recria Machos'], lotIds[spec.lotName],
          pastureIds['Pasto Fundo'], pastureIds['Pasto do Cocho'],
          'Transferência para terminação',
          userIds['gerente@santaclara.com.br'], NOW_TIMESTAMP,
        );
        total += 1;
      }
    }

    // Rotational grazing at Boa Vista.
    if (spec.farmKey !== 'boaVista') continue;

    let date = addDays(SIMULATION_START, gen.int(10, 70));
    let currentPasture = gen.pick(boaVistaPastures);

    while (date < lastDate) {
      const nextPasture = gen.pick(boaVistaPastures.filter((p) => p !== currentPasture));

      statement.run(
        spec.id, `${date}T07:30:00.000Z`,
        farmIds.boaVista, farmIds.boaVista,
        lotIds[spec.lotName], lotIds[spec.lotName],
        pastureIds[currentPasture], pastureIds[nextPasture],
        'Rodízio de pastagem',
        userIds['peao@boavista.com.br'], NOW_TIMESTAMP,
      );

      currentPasture = nextPasture;
      date = addDays(date, gen.int(110, 160));
      total += 1;
    }
  }

  return total;
}

/**
 * Eighteen months of costs for both farms.
 *
 * Feed costs rise sharply through the dry season, which is the single largest
 * driver of cost in this kind of operation and makes the stacked cost chart
 * worth reading.
 */
function insertCosts(db, farmIds, lotIds, userIds) {
  const categories = Object.fromEntries(
    db.prepare('SELECT slug, id FROM cost_categories').all().map((row) => [row.slug, row.id]),
  );

  const statement = db.prepare(
    `INSERT INTO costs
       (farm_id, lot_id, category_id, cost_date, amount_cents, description,
        is_recurring, recurrence_months, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const isDrySeason = (iso) => {
    const month = Number(iso.slice(5, 7));
    return month >= 5 && month <= 9;
  };

  let total = 0;

  const add = (farmId, lotId, slug, date, cents, description, recurring = 0, months = null) => {
    statement.run(
      farmId, lotId, categories[slug], date, cents, description,
      recurring, months, userIds['admin@gadomanager.com.br'], NOW_TIMESTAMP, NOW_TIMESTAMP,
    );
    total += 1;
  };

  for (let offset = 17; offset >= 0; offset -= 1) {
    const monthStart = startOfMonth(addMonths(TODAY, -offset));
    const dry = isDrySeason(monthStart);

    // --- Fazenda Boa Vista -------------------------------------------------
    add(farmIds.boaVista, null, 'mao_de_obra', addDays(monthStart, 4),
      gen.int(820000, 890000), 'Folha de pagamento', 1, 1);

    add(farmIds.boaVista, null, 'alimentacao', addDays(monthStart, gen.int(6, 14)),
      dry ? gen.int(900000, 1400000) : gen.int(320000, 520000),
      dry ? 'Suplementação proteica — seca' : 'Sal mineral');

    if (gen.chance(dry ? 0.7 : 0.35)) {
      add(farmIds.boaVista, lotIds['Recria Machos'], 'sanidade', addDays(monthStart, gen.int(8, 22)),
        gen.int(140000, 380000), 'Vermífugo e mineral injetável');
    }

    if (gen.chance(0.3)) {
      add(farmIds.boaVista, null, 'infraestrutura', addDays(monthStart, gen.int(5, 25)),
        gen.int(250000, 950000), gen.pick(['Manutenção de cercas', 'Reforma de bebedouro', 'Roçada de pasto']));
    }

    if (gen.chance(0.25)) {
      add(farmIds.boaVista, null, 'outros', addDays(monthStart, gen.int(3, 26)),
        gen.int(45000, 260000), gen.pick(['Combustível', 'Frete', 'Material de escritório']));
    }

    // --- Fazenda Santa Clara ----------------------------------------------
    add(farmIds.santaClara, null, 'mao_de_obra', addDays(monthStart, 4),
      gen.int(410000, 460000), 'Folha de pagamento', 1, 1);

    // Finishing runs on supplementation year-round; the dry season raises it.
    add(farmIds.santaClara, lotIds['Engorda A'], 'alimentacao', addDays(monthStart, gen.int(5, 12)),
      dry ? gen.int(1500000, 2100000) : gen.int(900000, 1350000), 'Ração de terminação');

    add(farmIds.santaClara, lotIds['Engorda B'], 'alimentacao', addDays(monthStart, gen.int(5, 12)),
      dry ? gen.int(950000, 1400000) : gen.int(600000, 900000), 'Ração de terminação');

    if (gen.chance(0.4)) {
      add(farmIds.santaClara, null, 'sanidade', addDays(monthStart, gen.int(10, 24)),
        gen.int(120000, 310000), 'Controle de ectoparasitas');
    }

    if (gen.chance(0.2)) {
      add(farmIds.santaClara, null, 'infraestrutura', addDays(monthStart, gen.int(6, 24)),
        gen.int(300000, 1200000), gen.pick(['Manutenção do cocho', 'Reforma do curral', 'Balança — manutenção']));
    }
  }

  return total;
}

/**
 * Seeds the provisional protocols and the doses they schedule.
 *
 * Doses are generated from each animal's own birth date, exactly as
 * `/protocolos/:id/agendar` would - so the demo data is what the application
 * itself produces, not a parallel fiction.
 *
 * Whether a due dose was actually applied is decided per animal, leaving a
 * realistic tail of genuinely overdue doses (the dashboard's alert panel needs
 * a real population) and some applied recently enough to still be in carência,
 * so that rule is visible too.
 */
function insertHealthEvents(db, specs, farmIds, userIds) {
  const protocolStatement = db.prepare(
    `INSERT INTO health_protocols
       (farm_id, name, kind, product, dose, dose_unit, withdrawal_days,
        schedule_mode, age_days, interval_days, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );

  const eventStatement = db.prepare(
    `INSERT INTO health_events
       (animal_id, protocol_id, kind, name, product, dose, dose_unit,
        scheduled_date, applied_date, applicator_user_id, withdrawal_days,
        batch_number, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const applicators = [userIds['peao@boavista.com.br'], userIds['gerente@boavista.com.br']];

  // Each farm keeps its own copy of the calendar, since protocols are
  // farm-scoped like every other record.
  const protocolIdsByFarm = {};
  for (const farmKey of Object.keys(farmIds)) {
    protocolIdsByFarm[farmKey] = HEALTH_PROTOCOLS.map((protocol) =>
      Number(
        protocolStatement.run(
          farmIds[farmKey], protocol.name, protocol.kind, protocol.product,
          protocol.dose, protocol.doseUnit, protocol.withdrawalDays,
          protocol.scheduleMode, protocol.ageDays, protocol.intervalDays,
          NOW_TIMESTAMP, NOW_TIMESTAMP,
        ).lastInsertRowid,
      ),
    );
  }

  let scheduled = 0;
  let applied = 0;

  for (const spec of specs) {
    const lastDate = spec.exitDate ?? TODAY;

    HEALTH_PROTOCOLS.forEach((protocol, index) => {
      if (!protocol.appliesTo(spec)) return;

      const doses = [addDays(spec.birthDate, protocol.ageDays)];
      if (protocol.intervalDays) doses.push(addDays(doses[0], protocol.intervalDays));

      for (const scheduledDate of doses) {
        // A dose the animal has not yet reached the age for, or one falling
        // after it left the herd, was never scheduled in the first place.
        if (scheduledDate > TODAY || scheduledDate > lastDate) continue;
        if (scheduledDate < SIMULATION_START) continue;

        // Most due doses get applied; the rest become the overdue tail.
        const wasApplied = gen.chance(0.82);
        const appliedDate = wasApplied
          ? addDays(scheduledDate, gen.int(0, 6))
          : null;

        if (appliedDate && appliedDate > TODAY) continue;

        eventStatement.run(
          spec.id,
          protocolIdsByFarm[spec.farmKey][index],
          protocol.kind,
          protocol.name,
          protocol.product,
          protocol.dose,
          protocol.doseUnit,
          scheduledDate,
          appliedDate,
          appliedDate ? gen.pick(applicators) : null,
          protocol.withdrawalDays,
          appliedDate ? `L${gen.int(1000, 9999)}` : null,
          NOW_TIMESTAMP,
          NOW_TIMESTAMP,
        );

        scheduled += 1;
        if (appliedDate) applied += 1;
      }
    });
  }

  return { protocols: HEALTH_PROTOCOLS.length * Object.keys(farmIds).length, scheduled, applied };
}

function insertReminders(db, farmIds, userIds) {
  const statement = db.prepare(
    `INSERT INTO reminders
       (farm_id, title, description, due_date, assigned_user_id, done_at, recurrence,
        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const reminders = [
    { farm: 'boaVista', title: 'Pesagem geral do rebanho', due: addDays(TODAY, 6),
      assigned: 'peao@boavista.com.br', done: null, recurrence: 'mensal' },
    { farm: 'boaVista', title: 'Revisar cercas do Pasto Fundo', due: addDays(TODAY, 12),
      assigned: 'peao@boavista.com.br', done: null, recurrence: 'nenhuma' },
    { farm: 'boaVista', title: 'Comprar sal mineral', due: addDays(TODAY, -4),
      assigned: 'gerente@boavista.com.br', done: null, recurrence: 'mensal' },
    { farm: 'santaClara', title: 'Negociar lote de terminação', due: addDays(TODAY, 20),
      assigned: 'gerente@santaclara.com.br', done: null, recurrence: 'nenhuma' },
    { farm: 'santaClara', title: 'Manutenção da balança', due: addDays(TODAY, -30),
      assigned: 'gerente@santaclara.com.br', done: `${addDays(TODAY, -28)}T14:00:00.000Z`, recurrence: 'anual' },
  ];

  for (const reminder of reminders) {
    statement.run(
      farmIds[reminder.farm], reminder.title, null, reminder.due,
      userIds[reminder.assigned], reminder.done, reminder.recurrence,
      userIds['admin@gadomanager.com.br'], NOW_TIMESTAMP, NOW_TIMESTAMP,
    );
  }

  return reminders.length;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main() {
  if (isProduction) {
    console.error('Refusing to seed: NODE_ENV is production. This script deletes all data.');
    process.exit(1);
  }

  const db = getDb();

  console.log('Seeding demo dataset (this replaces all existing data)...\n');

  // The password hash is computed outside the transaction because it is async
  // and better-sqlite3 transactions must be synchronous.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  let summary;

  const run = db.transaction(() => {
    reset(db);

    const farmIds = insertFarms(db);
    const { pastureIds, lotIds } = insertStructure(db, farmIds);

    const userStatement = db.prepare(
      `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    const grantStatement = db.prepare('INSERT INTO user_farms (user_id, farm_id) VALUES (?, ?)');

    const userIds = {};
    for (const user of USERS) {
      const userId = Number(
        userStatement.run(user.name, user.email, passwordHash, user.role, NOW_TIMESTAMP, NOW_TIMESTAMP)
          .lastInsertRowid,
      );
      userIds[user.email] = userId;
      for (const farmKey of user.farms) grantStatement.run(userId, farmIds[farmKey]);
    }

    const specs = buildAnimalSpecs();
    attachCurves(specs);
    const { sales, deaths } = assignExits(specs);

    insertAnimals(db, specs, farmIds, lotIds, pastureIds);

    const weighingCount = insertWeighings(db, specs, userIds);
    const saleItemCount = insertSales(db, sales, farmIds, userIds);
    const deathCount = insertDeaths(db, deaths, userIds);
    const movementCount = insertMovements(db, specs, farmIds, lotIds, pastureIds, userIds);
    const costCount = insertCosts(db, farmIds, lotIds, userIds);
    const reminderCount = insertReminders(db, farmIds, userIds);
    const health = insertHealthEvents(db, specs, farmIds, userIds);

    summary = {
      farms: FARMS.length,
      lots: LOTS.length,
      pastures: PASTURES.length,
      users: USERS.length,
      animals: specs.length,
      weighings: weighingCount,
      sales: sales.filter((s) => s.animals.length > 0).length,
      saleItems: saleItemCount,
      deaths: deathCount,
      movements: movementCount,
      costs: costCount,
      reminders: reminderCount,
      protocols: health.protocols,
      healthScheduled: health.scheduled,
      healthApplied: health.applied,
    };
  });

  try {
    run();

    const counts = (sql) => db.prepare(sql).get().c;

    console.log('Dataset created:');
    console.log(`  Fazendas ............ ${summary.farms}`);
    console.log(`  Lotes ............... ${summary.lots}`);
    console.log(`  Pastos .............. ${summary.pastures}`);
    console.log(`  Usuários ............ ${summary.users}`);
    console.log(`  Animais ............. ${summary.animals}`);
    console.log(`    ativos ............ ${counts("SELECT COUNT(*) c FROM animals WHERE status='ativo'")}`);
    console.log(`    vendidos .......... ${counts("SELECT COUNT(*) c FROM animals WHERE status='vendido'")}`);
    console.log(`    mortos ............ ${counts("SELECT COUNT(*) c FROM animals WHERE status='morto'")}`);
    console.log(`    transferidos ...... ${counts("SELECT COUNT(*) c FROM animals WHERE status='transferido'")}`);
    console.log(`  Pesagens ............ ${summary.weighings}`);
    console.log(`  Vendas .............. ${summary.sales} (${summary.saleItems} animais)`);
    console.log(`  Mortes .............. ${summary.deaths}`);
    console.log(`  Movimentações ....... ${summary.movements}`);
    console.log(`  Custos .............. ${summary.costs}`);
    console.log(`  Lembretes ........... ${summary.reminders}`);
    console.log(`  Protocolos .......... ${summary.protocols}`);
    console.log(`  Doses agendadas ..... ${summary.healthScheduled}`);
    console.log(`    aplicadas ......... ${summary.healthApplied}`);
    console.log(`    atrasadas ......... ${counts("SELECT COUNT(*) c FROM health_events he JOIN animals a ON a.id=he.animal_id WHERE he.applied_date IS NULL AND a.status='ativo'")}`);

    console.log('\nContas de demonstração (senha para todas: ' + DEMO_PASSWORD + '):');
    for (const user of USERS) {
      console.log(`  ${user.email.padEnd(32)} ${user.role.padEnd(8)} ${user.farms.join(', ')}`);
    }

    console.log(
      '\nATENÇÃO: o calendário sanitário semeado é PROVISÓRIO. Os protocolos são\n' +
        'dados editáveis em /protocolos — confirme-os com a bibliografia do TCC.',
    );
  } finally {
    closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
