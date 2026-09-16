import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WorkspaceStorage} from './lib/storage.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(ROOT, 'public');
const TEAMS = [
  {id: 'logistics', name: '물류팀'},
  {id: 'scaleup', name: '스케일업팀'},
  {id: 'quality-assurance', name: '품질보증팀'},
  {id: 'quality-control-2', name: '품질관리2팀'},
  {id: 'quality-control-4-retest', name: '품질관리4팀 · 재시험'},
  {id: 'quality-control-4-automation', name: '품질관리4팀 · 자동화'},
];
const TEAM_IDS = new Set(TEAMS.map(({id}) => id));
const STATUS = new Set(['uploaded', 'queued', 'processing', 'completed', 'error']);
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', ...headers});
  response.end(JSON.stringify(body));
};

const readBody = async (request, limit) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) {
      const error = new Error('업로드 가능한 크기를 초과했습니다.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const safeName = (value) => {
  const name = path.basename(String(value || 'file'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (name || 'file').slice(0, 180);
};

const extension = (name) => path.extname(name).toLowerCase();
const previewType = (file, officeEnabled) => {
  if (file.mime === 'application/pdf' || extension(file.name) === '.pdf') return 'pdf';
  if (file.mime.startsWith('image/')) return 'image';
  if (file.mime.startsWith('video/')) return 'video';
  if (file.mime.startsWith('audio/')) return 'audio';
  if (file.mime.startsWith('text/') || ['.txt', '.md', '.json', '.xml', '.csv'].includes(extension(file.name))) return 'text';
  if (officeEnabled && ['.xlsx', '.xls', '.xlsm', '.ods', '.docx', '.doc', '.odt', '.pptx', '.ppt', '.odp'].includes(extension(file.name))) return 'office';
  return 'download';
};

const officeDocumentType = (name) => {
  const ext = extension(name);
  if (['.xlsx', '.xls', '.xlsm', '.ods', '.csv'].includes(ext)) return 'cell';
  if (['.pptx', '.ppt', '.odp'].includes(ext)) return 'slide';
  return 'word';
};

const publicFile = (file, officeEnabled) => ({
  id: file.id,
  team: file.team,
  name: file.name,
  mime: file.mime,
  size: file.size,
  kind: file.kind,
  sourceId: file.sourceId,
  status: file.status,
  preview: previewType(file, officeEnabled),
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const bearer = (request) => {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
};

const equalSecret = (actual, expected) => {
  const left = Buffer.from(actual || '');
  const right = Buffer.from(expected || '');
  return left.length === right.length && timingSafeEqual(left, right);
};

const createSigner = (secret) => {
  const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    encode(payload) {
      const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${value}.${sign(value)}`;
    },
    decode(token) {
      const [value, signature] = String(token || '').split('.');
      if (!value || !signature || !equalSecret(signature, sign(value))) return null;
      try {
        const payload = JSON.parse(Buffer.from(value, 'base64url').toString());
        return payload.exp && payload.exp > Date.now() ? payload : null;
      } catch {
        return null;
      }
    },
  };
};

const createJwt = (payload, secret) => {
  const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
};

const cookies = (request) => Object.fromEntries(
  (request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key),
);

const requestOrigin = (request) => {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || 'http';
  const host = forwardedHost || request.headers.host;
  return `${protocol}://${host}`;
};

export async function createWorkspaceServer(options = {}) {
  const config = {
    port: Number(options.port ?? process.env.PORT ?? 3000),
    dataDir: options.dataDir ?? process.env.DATA_DIR ?? path.join(ROOT, 'data'),
    eventCode: options.eventCode ?? process.env.EVENT_CODE,
    n8nApiKey: options.n8nApiKey ?? process.env.N8N_API_KEY,
    adminKey: options.adminKey ?? process.env.ADMIN_KEY,
    sessionSecret: options.sessionSecret ?? process.env.SESSION_SECRET,
    sessionHours: Number(options.sessionHours ?? process.env.SESSION_HOURS ?? 12),
    maxUploadBytes: Number(options.maxUploadBytes ?? (Number(process.env.MAX_UPLOAD_MB ?? 30) * 1024 * 1024)),
    officeEnabled: options.officeEnabled ?? process.env.ONLYOFFICE_ENABLED === 'true',
    officeJwtSecret: options.officeJwtSecret ?? process.env.ONLYOFFICE_JWT_SECRET,
    officeAppInternalOrigin: options.officeAppInternalOrigin ?? process.env.ONLYOFFICE_APP_INTERNAL_ORIGIN,
    officeServerInternalOrigin: options.officeServerInternalOrigin ?? process.env.ONLYOFFICE_SERVER_INTERNAL_ORIGIN,
  };
  const missing = ['eventCode', 'n8nApiKey', 'adminKey', 'sessionSecret'].filter((key) => !config[key]);
  if (missing.length) throw new Error(`필수 환경변수가 없습니다: ${missing.join(', ')}`);
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET은 32자 이상이어야 합니다.');
  if (config.officeEnabled && !config.officeJwtSecret) throw new Error('ONLYOFFICE_JWT_SECRET이 필요합니다.');

  const storage = new WorkspaceStorage(config.dataDir);
  await storage.init();
  const signer = createSigner(config.sessionSecret);
  const sessionFor = (request) => signer.decode(cookies(request).openlab_session);
  const fileAccess = (request, file, url) => {
    const session = sessionFor(request);
    if (session?.team === file.team) return true;
    if (equalSecret(bearer(request), config.n8nApiKey) || equalSecret(bearer(request), config.adminKey)) return true;
    const grant = signer.decode(url.searchParams.get('access'));
    return grant?.purpose === 'file' && grant.fileId === file.id;
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, requestOrigin(request));
    const route = url.pathname;
    try {
      if (request.method === 'GET' && route === '/health') {
        return json(response, 200, {ok: true, officeEnabled: config.officeEnabled});
      }

      if (request.method === 'POST' && route === '/api/session') {
        const body = JSON.parse((await readBody(request, 16 * 1024)).toString() || '{}');
        if (!equalSecret(body.eventCode, config.eventCode)) return json(response, 401, {error: '행사 코드를 확인해 주세요.'});
        if (!TEAM_IDS.has(body.team)) return json(response, 422, {error: '팀을 선택해 주세요.'});
        const token = signer.encode({team: body.team, exp: Date.now() + config.sessionHours * 3_600_000});
        return json(response, 200, {team: body.team}, {
          'set-cookie': `openlab_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionHours * 3600}`,
        });
      }

      if (request.method === 'DELETE' && route === '/api/session') {
        return json(response, 200, {ok: true}, {'set-cookie': 'openlab_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'});
      }

      if (request.method === 'GET' && route === '/api/session') {
        const session = sessionFor(request);
        if (!session) return json(response, 401, {error: '입장이 필요합니다.'});
        return json(response, 200, {team: session.team, teams: TEAMS, officeEnabled: config.officeEnabled});
      }

      if (route === '/api/files' && request.method === 'GET') {
        const session = sessionFor(request);
        if (!session) return json(response, 401, {error: '입장이 필요합니다.'});
        const files = await storage.list(session.team);
        return json(response, 200, {files: files.map((file) => publicFile(file, config.officeEnabled))});
      }

      if (route === '/api/files' && request.method === 'POST') {
        const session = sessionFor(request);
        if (!session) return json(response, 401, {error: '입장이 필요합니다.'});
        const raw = await readBody(request, config.maxUploadBytes + 1024 * 1024);
        const webRequest = new Request('http://workspace.local/upload', {
          method: 'POST',
          headers: {'content-type': request.headers['content-type'] || ''},
          body: raw,
        });
        const form = await webRequest.formData();
        const upload = form.get('file');
        if (!(upload instanceof File) || upload.size === 0) return json(response, 422, {error: '파일을 선택해 주세요.'});
        if (upload.size > config.maxUploadBytes) return json(response, 413, {error: '업로드 가능한 크기를 초과했습니다.'});
        const file = await storage.create({
          team: session.team,
          name: safeName(upload.name),
          mime: upload.type,
          bytes: Buffer.from(await upload.arrayBuffer()),
        });
        return json(response, 201, {file: publicFile(file, config.officeEnabled)});
      }

      const contentMatch = route.match(/^\/api\/files\/([^/]+)\/content$/);
      if (contentMatch && request.method === 'GET') {
        const file = await storage.get(contentMatch[1]);
        if (!file) return json(response, 404, {error: '파일을 찾을 수 없습니다.'});
        if (!fileAccess(request, file, url)) return json(response, 401, {error: '파일 접근 권한이 없습니다.'});
        const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
        response.writeHead(200, {
          'content-type': file.mime,
          'content-length': file.size,
          'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          'cache-control': 'private, no-store',
        });
        return response.end(await storage.content(file));
      }

      const deleteMatch = route.match(/^\/api\/files\/([^/]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const session = sessionFor(request);
        if (!session) return json(response, 401, {error: '입장이 필요합니다.'});
        const file = await storage.get(deleteMatch[1]);
        if (!file || file.team !== session.team) return json(response, 404, {error: '파일을 찾을 수 없습니다.'});
        await storage.delete(file.id);
        return json(response, 200, {ok: true});
      }

      const queueMatch = route.match(/^\/api\/files\/([^/]+)\/queue$/);
      if (queueMatch && request.method === 'POST') {
        const session = sessionFor(request);
        if (!session) return json(response, 401, {error: '입장이 필요합니다.'});
        const file = await storage.get(queueMatch[1]);
        if (!file || file.team !== session.team) return json(response, 404, {error: '파일을 찾을 수 없습니다.'});
        if (file.kind !== 'original') return json(response, 409, {error: '원본 파일만 n8n에 전달할 수 있습니다.'});
        const updated = await storage.update(file.id, {status: 'queued'});
        return json(response, 200, {file: publicFile(updated, config.officeEnabled)});
      }

      const configMatch = route.match(/^\/api\/onlyoffice\/config\/([^/]+)$/);
      if (configMatch && request.method === 'GET') {
        const session = sessionFor(request);
        if (!session) return json(response, 401, {error: '입장이 필요합니다.'});
        if (!config.officeEnabled) return json(response, 503, {error: '문서 편집기가 실행되지 않았습니다.'});
        const file = await storage.get(configMatch[1]);
        if (!file || file.team !== session.team) return json(response, 404, {error: '파일을 찾을 수 없습니다.'});
        const origin = config.officeAppInternalOrigin || requestOrigin(request);
        const access = signer.encode({purpose: 'file', fileId: file.id, exp: Date.now() + 2 * 3_600_000});
        const callback = signer.encode({purpose: 'office-callback', fileId: file.id, exp: Date.now() + 2 * 3_600_000});
        const officeConfig = {
          documentType: officeDocumentType(file.name),
          document: {
            fileType: extension(file.name).slice(1),
            key: `${file.id}-${Date.parse(file.updatedAt)}`,
            title: file.name,
            url: `${origin}/api/files/${file.id}/content?access=${encodeURIComponent(access)}`,
            permissions: {download: true, edit: true, print: true},
          },
          editorConfig: {
            callbackUrl: `${origin}/api/onlyoffice/callback/${file.id}?access=${encodeURIComponent(callback)}`,
            lang: 'ko',
            mode: 'edit',
            user: {id: `team-${file.team}`, name: TEAMS.find((team) => team.id === file.team)?.name || file.team},
            customization: {
              compactHeader: true,
              forcesave: true,
              help: false,
              hideRightMenu: true,
              features: {featuresTips: false},
            },
          },
        };
        officeConfig.token = createJwt(officeConfig, config.officeJwtSecret);
        return json(response, 200, officeConfig);
      }

      const callbackMatch = route.match(/^\/api\/onlyoffice\/callback\/([^/]+)$/);
      if (callbackMatch && request.method === 'POST') {
        const grant = signer.decode(url.searchParams.get('access'));
        if (grant?.purpose !== 'office-callback' || grant.fileId !== callbackMatch[1]) return json(response, 401, {error: 1});
        const body = JSON.parse((await readBody(request, 256 * 1024)).toString() || '{}');
        if (![2, 6].includes(body.status)) return json(response, 200, {error: 0});
        const source = await storage.get(callbackMatch[1]);
        if (!source || !body.url) return json(response, 404, {error: 1});
        const downloadUrl = new URL(body.url);
        const resolvedDownloadUrl = config.officeServerInternalOrigin
          ? `${config.officeServerInternalOrigin}${downloadUrl.pathname}${downloadUrl.search}`
          : body.url;
        const downloaded = await fetch(resolvedDownloadUrl);
        if (!downloaded.ok) return json(response, 502, {error: 1});
        const ext = extension(source.name);
        const base = path.basename(source.name, ext);
        await storage.create({
          team: source.team,
          name: safeName(`${base}-편집본${ext}`),
          mime: source.mime,
          bytes: Buffer.from(await downloaded.arrayBuffer()),
          kind: 'result',
          sourceId: source.id,
        });
        return json(response, 200, {error: 0});
      }

      if (route === '/api/n8n/files' && request.method === 'GET') {
        if (!equalSecret(bearer(request), config.n8nApiKey)) return json(response, 401, {error: 'API 키를 확인해 주세요.'});
        const team = url.searchParams.get('team');
        if (!TEAM_IDS.has(team)) return json(response, 422, {error: '유효한 team이 필요합니다.'});
        const status = url.searchParams.get('status') || undefined;
        if (status && !STATUS.has(status)) return json(response, 422, {error: '유효한 status가 필요합니다.'});
        const files = await storage.list(team, {status});
        return json(response, 200, {files: files.map((file) => publicFile(file, config.officeEnabled))});
      }

      const n8nFileMatch = route.match(/^\/api\/n8n\/files\/([^/]+)$/);
      if (n8nFileMatch && request.method === 'PATCH') {
        if (!equalSecret(bearer(request), config.n8nApiKey)) return json(response, 401, {error: 'API 키를 확인해 주세요.'});
        const body = JSON.parse((await readBody(request, 16 * 1024)).toString() || '{}');
        if (!STATUS.has(body.status)) return json(response, 422, {error: '유효한 status가 필요합니다.'});
        const file = await storage.update(n8nFileMatch[1], {status: body.status});
        return file ? json(response, 200, {file: publicFile(file, config.officeEnabled)}) : json(response, 404, {error: '파일을 찾을 수 없습니다.'});
      }

      if (route === '/api/n8n/results' && request.method === 'PUT') {
        if (!equalSecret(bearer(request), config.n8nApiKey)) return json(response, 401, {error: 'API 키를 확인해 주세요.'});
        const team = url.searchParams.get('team');
        const sourceId = url.searchParams.get('sourceId');
        if (!TEAM_IDS.has(team)) return json(response, 422, {error: '유효한 team이 필요합니다.'});
        const source = await storage.get(sourceId);
        if (!source || source.team !== team || source.kind !== 'original') return json(response, 422, {error: '같은 팀의 원본 sourceId가 필요합니다.'});
        const bytes = await readBody(request, config.maxUploadBytes);
        if (!bytes.length) return json(response, 422, {error: '결과 파일 본문이 비어 있습니다.'});
        const file = await storage.create({
          team,
          name: safeName(url.searchParams.get('name') || 'result.bin'),
          mime: request.headers['content-type'],
          bytes,
          kind: 'result',
          sourceId,
        });
        await storage.update(source.id, {status: 'completed'});
        return json(response, 201, {file: publicFile(file, config.officeEnabled)});
      }

      if (route === '/api/admin/manifest' && request.method === 'GET') {
        if (!equalSecret(bearer(request), config.adminKey)) return json(response, 401, {error: '관리자 키를 확인해 주세요.'});
        return json(response, 200, {files: await storage.all()});
      }

      if (route === '/api/admin/cleanup' && request.method === 'POST') {
        if (!equalSecret(bearer(request), config.adminKey)) return json(response, 401, {error: '관리자 키를 확인해 주세요.'});
        const body = JSON.parse((await readBody(request, 16 * 1024)).toString() || '{}');
        if (body.confirm !== 'DELETE ALL WORKSHOP FILES') return json(response, 422, {error: '삭제 확인 문구가 필요합니다.'});
        return json(response, 200, await storage.clear());
      }

      if (request.method === 'GET' && !route.startsWith('/api/')) {
        const relative = route === '/' || route === '/workspace/'
          ? 'index.html'
          : route.replace(/^\/workspace\/?/, '').replace(/^\/+/, '');
        const target = path.resolve(PUBLIC_ROOT, relative);
        if (!target.startsWith(PUBLIC_ROOT)) return json(response, 404, {error: '찾을 수 없습니다.'});
        try {
          const content = await readFile(target);
          response.writeHead(200, {'content-type': STATIC_TYPES[path.extname(target)] || 'application/octet-stream'});
          return response.end(content);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const content = await readFile(path.join(PUBLIC_ROOT, 'index.html'));
          response.writeHead(200, {'content-type': STATIC_TYPES['.html']});
          return response.end(content);
        }
      }

      return json(response, 404, {error: '찾을 수 없습니다.'});
    } catch (error) {
      console.error(error);
      return json(response, error.status || 500, {error: error.status ? error.message : '요청을 처리하지 못했습니다.'});
    }
  });

  return {server, storage, config};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {server, config} = await createWorkspaceServer();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Open Lab workspace listening on http://0.0.0.0:${config.port}`);
  });
}
