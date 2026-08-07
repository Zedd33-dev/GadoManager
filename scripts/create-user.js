/**
 * Creates a user from the command line.
 *
 * Exists so that a fresh installation can be logged into before the demo seed
 * runs, and so an admin account can be created directly with `--role admin`
 * and (optionally) an initial farm - the public registration form at
 * /registrar always creates a farm-less `peao`, on purpose, and can never be
 * used to self-grant admin.
 *
 * Usage:
 *   node scripts/create-user.js --name "Ana Souza" --email ana@fazenda.com \
 *                               --role admin --password "senha-forte" [--farm 1]
 */

import { getDb, closeDb } from '../src/config/db.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/password.js';
import { insertUser, grantFarmAccess, findActiveByEmail } from '../src/repositories/userRepository.js';
import { ALL_ROLES } from '../src/domain/permissions.js';

/**
 * Parses `--key value` pairs from argv.
 *
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) continue;
    args[key] = value;
    i += 1;
  }

  return args;
}

function fail(message) {
  console.error(`\nError: ${message}\n`);
  console.error('Usage:');
  console.error(
    '  node scripts/create-user.js --name "Ana Souza" --email ana@fazenda.com --role admin --password "senha-forte" [--farm 1]',
  );
  console.error(`\nRoles: ${ALL_ROLES.join(', ')}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const name = args.name?.trim();
  const email = args.email?.trim().toLowerCase();
  const role = args.role?.trim();
  const password = args.password;

  if (!name) fail('--name is required.');
  if (!email) fail('--email is required.');
  if (!role || !ALL_ROLES.includes(role)) fail(`--role must be one of: ${ALL_ROLES.join(', ')}`);
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    fail(`--password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const db = getDb();

  try {
    if (findActiveByEmail(db, email)) fail(`A user with the email ${email} already exists.`);

    const passwordHash = await hashPassword(password);
    const userId = insertUser(db, { name, email, passwordHash, role });

    console.log(`Created user #${userId}: ${name} <${email}> (${role})`);

    if (args.farm) {
      const farmId = Number.parseInt(args.farm, 10);
      if (!Number.isInteger(farmId)) fail('--farm must be a numeric farm id.');

      const farm = db.prepare('SELECT id, name FROM farms WHERE id = ?').get(farmId);
      if (!farm) fail(`No farm with id ${farmId}.`);

      grantFarmAccess(db, userId, farmId);
      console.log(`Granted access to farm #${farm.id}: ${farm.name}`);
    } else {
      console.log(
        '\nNote: no farm granted. This user will be blocked until linked to a farm.\n' +
          'Re-run with --farm <id>, or run the demo seed.',
      );
    }
  } finally {
    closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
