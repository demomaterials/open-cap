import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'catalog');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));

test('every control has a rego file and a known asset type', () => {
  const types = new Set(catalog.assetTypes.map((t) => t.type));
  for (const c of catalog.controls) {
    assert.ok(fs.existsSync(path.join(dir, 'rego', `${c.key}.rego`)), `missing rego for ${c.key}`);
    for (const t of c.asset_types) assert.ok(types.has(t), `${c.key}: unknown type ${t}`);
  }
});

test('frameworks reference existing controls', () => {
  const keys = new Set(catalog.controls.map((c) => c.key));
  for (const f of catalog.frameworks) for (const [k] of f.controls) assert.ok(keys.has(k), `${f.key}: unknown control ${k}`);
});
