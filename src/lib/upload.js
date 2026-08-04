/**
 * Photo upload handling.
 *
 * Two things a naive `multer` setup gets wrong, both fixed here:
 *
 *   1. Files must never land under `public/` - anything there is served to
 *      anyone with the URL, with no session check and no tenant scoping. A
 *      farm's animal photos are stored under `data/uploads/`, outside the
 *      static file root, and are only ever served through
 *      `routes/animals.js`'s own authenticated, scope-checked route.
 *   2. The MIME type multer reports is whatever the browser's `Content-Type`
 *      header claimed - trivially spoofable, not a real validation. It is
 *      still checked as a cheap first filter, but is not the only check
 *      (see `sniffImageType` below).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { ROOT_DIR } from '../config/env.js';
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from '../domain/constants.js';

export const UPLOADS_DIR = path.join(ROOT_DIR, 'data', 'uploads', 'animals');

const EXTENSION_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Magic-byte signatures for the three accepted formats. */
const SIGNATURES = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: 'RIFF' .... 'WEBP' - the size field in between is skipped.
  { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, webp: true },
];

/**
 * Identifies an image format from its leading bytes, ignoring whatever
 * `Content-Type` the upload claimed.
 *
 * This is the real validation: a browser's declared MIME type is just a
 * string the client sent and can say anything, but the first bytes of an
 * actual JPEG/PNG/WebP file are effectively impossible to fake by accident
 * and expensive to fake on purpose while still being a working image.
 *
 * @param {Buffer} buffer at least the first 12 bytes of the file
 * @returns {string|null} a MIME type from ALLOWED_PHOTO_TYPES, or null
 */
export function sniffImageType(buffer) {
  for (const signature of SIGNATURES) {
    if (buffer.length < signature.bytes.length) continue;
    const matches = signature.bytes.every((byte, index) => buffer[index] === byte);
    if (!matches) continue;

    if (signature.webp) {
      // Bytes 8-11 must additionally read 'WEBP'.
      const webpMarker = buffer.subarray(8, 12).toString('ascii');
      if (webpMarker !== 'WEBP') continue;
    }

    return signature.type;
  }
  return null;
}

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/**
 * Multer middleware for a single `foto` field.
 *
 * Filenames are random, not derived from the original name or the animal id:
 * the original name is attacker-controlled input, and an id-derived name
 * would let one guess every other animal's photo URL pattern even though the
 * serving route itself is scope-checked.
 */
export const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, UPLOADS_DIR),
    filename: (req, file, callback) => {
      const extension = EXTENSION_BY_TYPE[file.mimetype] ?? '';
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) {
      callback(new Error('Formato de imagem não suportado. Envie um arquivo JPEG, PNG ou WebP.'));
      return;
    }
    callback(null, true);
  },
}).single('foto');

/**
 * Verifies a stored upload's real content matches an accepted image type,
 * deleting it and returning false if not.
 *
 * multer's `fileFilter` only sees the claimed Content-Type before any bytes
 * are on disk. This second check reads the file that was actually written and
 * rejects it on content, closing the gap a spoofed Content-Type would open.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function verifyStoredImage(filePath) {
  const handle = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(12);
  fs.readSync(handle, header, 0, 12, 0);
  fs.closeSync(handle);

  const detected = sniffImageType(header);
  if (detected && ALLOWED_PHOTO_TYPES.includes(detected)) return true;

  fs.unlinkSync(filePath);
  return false;
}

/** Deletes a stored photo file, ignoring a missing file. */
export function deleteStoredPhoto(relativePath) {
  if (!relativePath) return;
  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, relativePath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
