/**
 * Safe JSON embedding for server-rendered HTML.
 *
 * `JSON.stringify` alone is not safe to place inside a `<script>` tag: a
 * string value containing `</script>` would close the tag early and let
 * whatever follows execute as HTML/script content. Escaping `<` as `<`
 * neutralises that without changing the JSON's meaning - `<` decodes back
 * to `<` when `JSON.parse` reads it.
 *
 * Used to embed each chart's data as `<script type="application/json">`,
 * which `public/js/charts.js` reads with `JSON.parse` - no inline script, no
 * `eval`, compatible with the CSP's `script-src 'self'`.
 */

/**
 * @param {unknown} value
 * @returns {string} JSON text safe to place inside a `<script>` element
 */
export function toEmbeddableJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
