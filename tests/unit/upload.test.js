/**
 * Tests for image content sniffing.
 *
 * The property under test: acceptance is decided by the file's actual bytes,
 * never by whatever Content-Type the upload claimed. A renamed .exe with a
 * `.jpg` extension and an `image/jpeg` Content-Type must still be rejected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sniffImageType, verifyStoredImage } from '../../src/lib/upload.js';

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // size (arbitrary)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);

test('sniffImageType recognises a real JPEG header', () => {
  assert.equal(sniffImageType(JPEG_HEADER), 'image/jpeg');
});

test('sniffImageType recognises a real PNG header', () => {
  assert.equal(sniffImageType(PNG_HEADER), 'image/png');
});

test('sniffImageType recognises a real WebP header', () => {
  assert.equal(sniffImageType(WEBP_HEADER), 'image/webp');
});

test('sniffImageType rejects a RIFF file that is not WebP (e.g. a .wav)', () => {
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
  assert.equal(sniffImageType(wav), null);
});

test('sniffImageType rejects a plain text file renamed to look like an image', () => {
  const fakeJpeg = Buffer.from('this is not actually a jpeg image at all');
  assert.equal(sniffImageType(fakeJpeg), null);
});

test('sniffImageType rejects an executable header (MZ)', () => {
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
  assert.equal(sniffImageType(exe), null);
});

test('sniffImageType handles a buffer shorter than any signature', () => {
  assert.equal(sniffImageType(Buffer.from([0xff])), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

test('verifyStoredImage accepts a file whose bytes are a real JPEG and leaves it in place', () => {
  const tmpFile = path.join(os.tmpdir(), `gadomanager-test-${Date.now()}.jpg`);
  fs.writeFileSync(tmpFile, JPEG_HEADER);

  assert.equal(verifyStoredImage(tmpFile), true);
  assert.equal(fs.existsSync(tmpFile), true);

  fs.unlinkSync(tmpFile);
});

test('verifyStoredImage rejects and deletes a file whose bytes are not an image', () => {
  const tmpFile = path.join(os.tmpdir(), `gadomanager-test-${Date.now()}-fake.jpg`);
  fs.writeFileSync(tmpFile, 'not an image, just renamed to look like one');

  assert.equal(verifyStoredImage(tmpFile), false);
  assert.equal(fs.existsSync(tmpFile), false, 'a spoofed upload must be deleted, not left on disk');
});
