import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModule, interpret, packagePath } from '../evaluator/policy.js';

test('interpret: skip wins over everything', () => {
  assert.deepEqual(interpret({ skip: true, pass: false, violations: ['x'], skip_reason: 'archived' }), { status: 'skip', reasons: ['archived'] });
});

test('interpret: violations mean fail', () => {
  assert.deepEqual(interpret({ pass: true, violations: ['no review'] }), { status: 'fail', reasons: ['no review'] });
});

test('interpret: pass boolean', () => {
  assert.equal(interpret({ pass: true }).status, 'pass');
  assert.equal(interpret({ pass: false }).status, 'fail');
});

test('interpret: empty violations set alone means pass', () => {
  assert.equal(interpret({ violations: [] }).status, 'pass');
});

test('interpret: no decision is an error (unexecutable)', () => {
  assert.equal(interpret(undefined).status, 'error');
  assert.equal(interpret({ foo: 1 }).status, 'error');
});

test('buildModule rewrites the package line in place', () => {
  const id = '0f8e6a52-1111-2222-3333-444455556666';
  const { module } = buildModule(id, '# c\npackage cap\n\npass := true\n');
  const lines = module.split('\n');
  assert.equal(lines[1], `package ${packagePath(id).replace(/\//g, '.')}`);
  assert.equal(lines.length, 5);
});

test('buildModule prepends a package when missing', () => {
  const { module } = buildModule('abc', 'pass := true');
  assert.match(module, /^package cap\.controls\.c_abc\n/);
});

test('buildModule rejects network built-ins', () => {
  assert.match(buildModule('abc', 'package cap\nx := http.send({})').error, /http\.send/);
});
