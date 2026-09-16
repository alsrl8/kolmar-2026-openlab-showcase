import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceServer} from '../server.mjs';

const settings = {
  eventCode: 'openlab-test',
  n8nApiKey: 'n8n-test-key',
  adminKey: 'admin-test-key',
  sessionSecret: 'test-session-secret-longer-than-thirty-two-characters',
  officeEnabled: true,
  officeJwtSecret: 'office-test-secret',
  officeAppInternalOrigin: 'http://caddy:8080',
  officeServerInternalOrigin: 'http://onlyoffice',
  maxUploadBytes: 1024 * 1024,
};

const listen = async (dataDir) => {
  const workspace = await createWorkspaceServer({
    ...settings,
    dataDir,
    workflowRoot: path.join(import.meta.dirname, '..', 'n8n-workflows'),
  });
  await new Promise((resolve) => workspace.server.listen(0, '127.0.0.1', resolve));
  const address = workspace.server.address();
  return {...workspace, base: `http://127.0.0.1:${address.port}`};
};

const stop = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const login = async (base, team, eventCode = settings.eventCode) => {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({team, eventCode}),
  });
  return {response, cookie: response.headers.get('set-cookie')?.split(';')[0]};
};

test('one-day file journey, isolation, persistence and cleanup', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'openlab-workspace-'));
  t.after(() => rm(dataDir, {recursive: true, force: true}));
  let app = await listen(dataDir);

  const page = await fetch(`${app.base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Open Lab 작업공간/);
  const stylesheet = await fetch(`${app.base}/app.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  const browserScript = await fetch(`${app.base}/app.js`);
  assert.equal(browserScript.status, 200);
  assert.match(browserScript.headers.get('content-type'), /text\/javascript/);

  const badLogin = await login(app.base, 'logistics', 'wrong');
  assert.equal(badLogin.response.status, 401);

  const logistics = await login(app.base, 'logistics');
  assert.equal(logistics.response.status, 200);
  assert.ok(logistics.cookie);
  const scaleup = await login(app.base, 'scaleup');

  const deniedWorkflow = await fetch(`${app.base}/api/workflows/fetch-file-subworkflow.json`);
  assert.equal(deniedWorkflow.status, 401);
  const sharedWorkflow = await fetch(`${app.base}/api/workflows/fetch-file-subworkflow.json`, {headers: {cookie: logistics.cookie}});
  assert.equal(sharedWorkflow.status, 200);
  assert.match(sharedWorkflow.headers.get('content-disposition'), /attachment/);
  assert.equal((await sharedWorkflow.json()).id, 'openlab-fetch-file');
  const unknownWorkflow = await fetch(`${app.base}/api/workflows/unknown.json`, {headers: {cookie: logistics.cookie}});
  assert.equal(unknownWorkflow.status, 404);

  const form = new FormData();
  form.append('file', new File(['merged-cell-workbook'], '업무 현황.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const upload = await fetch(`${app.base}/api/files`, {
    method: 'POST', headers: {cookie: logistics.cookie}, body: form,
  });
  assert.equal(upload.status, 201);
  const original = (await upload.json()).file;
  assert.equal(original.kind, 'original');
  assert.equal(original.status, 'uploaded');
  assert.equal(original.preview, 'office');

  const officeConfig = await fetch(`${app.base}/api/onlyoffice/config/${original.id}`, {headers: {cookie: logistics.cookie}});
  assert.equal(officeConfig.status, 200);
  const editor = await officeConfig.json();
  assert.match(editor.document.url, /^http:\/\/caddy:8080\/api\/files\//);
  assert.match(editor.editorConfig.callbackUrl, /^http:\/\/caddy:8080\/api\/onlyoffice\/callback\//);
  assert.equal(editor.editorConfig.user.name, '물류팀');
  assert.equal(editor.editorConfig.customization.help, false);
  assert.equal(editor.editorConfig.customization.features.featuresTips, false);
  assert.equal(editor.token.split('.').length, 3);

  const ownList = await fetch(`${app.base}/api/files`, {headers: {cookie: logistics.cookie}});
  assert.equal((await ownList.json()).files.length, 1);
  const isolatedList = await fetch(`${app.base}/api/files`, {headers: {cookie: scaleup.cookie}});
  assert.equal((await isolatedList.json()).files.length, 0);
  const isolatedContent = await fetch(`${app.base}/api/files/${original.id}/content`, {headers: {cookie: scaleup.cookie}});
  assert.equal(isolatedContent.status, 401);

  const isolatedDelete = await fetch(`${app.base}/api/files/${original.id}`, {method: 'DELETE', headers: {cookie: scaleup.cookie}});
  assert.equal(isolatedDelete.status, 404);

  const queue = await fetch(`${app.base}/api/files/${original.id}/queue`, {method: 'POST', headers: {cookie: logistics.cookie}});
  assert.equal(queue.status, 200);
  assert.equal((await queue.json()).file.status, 'queued');

  const unauthorizedN8n = await fetch(`${app.base}/api/n8n/files?team=logistics&status=queued`);
  assert.equal(unauthorizedN8n.status, 401);
  const n8nHeaders = {authorization: `Bearer ${settings.n8nApiKey}`};
  const queued = await fetch(`${app.base}/api/n8n/files?team=logistics&status=queued`, {headers: n8nHeaders});
  assert.equal((await queued.json()).files[0].id, original.id);

  const processing = await fetch(`${app.base}/api/n8n/files/${original.id}`, {
    method: 'PATCH',
    headers: {...n8nHeaders, 'content-type': 'application/json'},
    body: JSON.stringify({status: 'processing'}),
  });
  assert.equal((await processing.json()).file.status, 'processing');

  const downloaded = await fetch(`${app.base}/api/files/${original.id}/content`, {headers: n8nHeaders});
  assert.equal(await downloaded.text(), 'merged-cell-workbook');

  const result = await fetch(`${app.base}/api/n8n/results?team=logistics&sourceId=${original.id}&name=${encodeURIComponent('처리 결과.pdf')}`, {
    method: 'PUT',
    headers: {...n8nHeaders, 'content-type': 'application/pdf'},
    body: Buffer.from('%PDF-result'),
  });
  assert.equal(result.status, 201);
  const resultFile = (await result.json()).file;
  assert.equal(resultFile.kind, 'result');
  assert.equal(resultFile.sourceId, original.id);
  assert.equal(resultFile.preview, 'pdf');

  await stop(app.server);
  app = await listen(dataDir);
  const relogin = await login(app.base, 'logistics');
  const persisted = await fetch(`${app.base}/api/files`, {headers: {cookie: relogin.cookie}});
  const persistedFiles = (await persisted.json()).files;
  assert.equal(persistedFiles.length, 2);
  assert.equal(persistedFiles.find((file) => file.id === original.id).status, 'completed');

  const metadata = JSON.parse(await readFile(path.join(dataDir, 'metadata.json'), 'utf8'));
  assert.equal(metadata.files.length, 2);

  const deleted = await fetch(`${app.base}/api/files/${resultFile.id}`, {
    method: 'DELETE', headers: {cookie: relogin.cookie},
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {ok: true});
  const deletedContent = await fetch(`${app.base}/api/files/${resultFile.id}/content`, {headers: {cookie: relogin.cookie}});
  assert.equal(deletedContent.status, 404);

  const deniedCleanup = await fetch(`${app.base}/api/admin/cleanup`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${settings.adminKey}`},
    body: JSON.stringify({confirm: 'no'}),
  });
  assert.equal(deniedCleanup.status, 422);
  const cleanup = await fetch(`${app.base}/api/admin/cleanup`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${settings.adminKey}`},
    body: JSON.stringify({confirm: 'DELETE ALL WORKSHOP FILES'}),
  });
  assert.deepEqual(await cleanup.json(), {removed: 1});
  await stop(app.server);
});
