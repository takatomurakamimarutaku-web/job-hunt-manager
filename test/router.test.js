import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, ROUTES } from '../js/router.js';

test('parseHash: 空・# のみ・/ はホーム', () => {
  for (const h of ['', '#', '#/', undefined]) assert.equal(parseHash(h).name, 'home');
});

test('parseHash: 固定パスとパラメータ付きパス', () => {
  assert.equal(parseHash('#/companies').name, 'companies');
  assert.deepEqual(parseHash('#/company/abc-123'), { name: 'company', params: { id: 'abc-123' }, query: {}, path: '/company/abc-123' });
  assert.equal(parseHash('#/company/new').name, 'companyNew');
  assert.deepEqual(parseHash('#/company/abc/edit').params, { id: 'abc' });
  assert.equal(parseHash('#/application/x1').name, 'application');
  assert.equal(parseHash('#/application/x1/edit').name, 'applicationEdit');
});

test('parseHash: クエリを読み取る', () => {
  const r = parseHash('#/application/new?companyId=c%201');
  assert.equal(r.name, 'applicationNew');
  assert.deepEqual(r.query, { companyId: 'c 1' });
});

test('parseHash: 未知のパス・不正なエンコードは notFound', () => {
  assert.equal(parseHash('#/unknown').name, 'notFound');
  assert.equal(parseHash('#/company/a/b/c').name, 'notFound');
  assert.equal(parseHash('#/company/%E0%A4%A').name, 'notFound');
});

test('parseHash: 仕様の全画面に対応する', () => {
  const paths = ['/home', '/companies', '/company/1', '/application/1', '/board', '/tasks', '/questions',
    '/documents', '/contacts', '/compare', '/stats', '/settings', '/backup', '/more', '/add'];
  for (const p of paths) assert.notEqual(parseHash(`#${p}`).name, 'notFound', p);
  assert.equal(new Set(ROUTES.map((r) => r.name)).size, ROUTES.length);
});

test('buildHash: 空の値はクエリから除く', () => {
  assert.equal(buildHash('/application/new', { companyId: 'c1', x: '' }), '#/application/new?companyId=c1');
  assert.equal(buildHash('/home'), '#/home');
});
