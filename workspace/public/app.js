const teams = [
  ['logistics', '물류팀'],
  ['scaleup', '스케일업팀'],
  ['quality-assurance', '품질보증팀'],
  ['quality-control-2', '품질관리2팀'],
  ['quality-control-4-retest', '품질관리4팀 · 재시험'],
  ['quality-control-4-automation', '품질관리4팀 · 자동화'],
];
const teamNames = Object.fromEntries(teams);
const gate = document.querySelector('#gate');
const workspace = document.querySelector('#workspace');
const entryForm = document.querySelector('#entry-form');
const entryError = document.querySelector('#entry-error');
const teamSelect = document.querySelector('#team');
const eventCode = document.querySelector('#event-code');
const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#preview-dialog');
const preview = document.querySelector('#preview');
const previewTitle = document.querySelector('#preview-title');
const downloadLink = document.querySelector('#download-link');
const guideDialog = document.querySelector('#guide-dialog');
let session = null;
let files = [];
let refreshTimer = null;

teams.forEach(([id, name]) => teamSelect.add(new Option(name, id)));

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
};

const showNotice = (message) => {
  notice.textContent = message;
  notice.hidden = false;
  window.setTimeout(() => { notice.hidden = true; }, 3500);
};

const fileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const fileLabel = (file) => {
  const ext = file.name.split('.').pop();
  return ext && ext.length < 6 ? ext : 'FILE';
};

const uploadedAt = (value) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)).map(({type, value: part}) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
};

const laneFor = (file) => {
  if (file.kind === 'result' || file.status === 'completed' || file.status === 'error') return 'completed';
  if (file.status === 'uploaded') return 'uploaded';
  return null;
};

const render = () => {
  const grouped = {uploaded: [], completed: []};
  files.forEach((file) => grouped[laneFor(file)]?.push(file));
  Object.entries(grouped).forEach(([lane, laneFiles]) => {
    const container = document.querySelector(`#${lane}-list`);
    container.replaceChildren(...laneFiles.map(fileCard));
    document.querySelector(`[data-lane="${lane}"] .count`).textContent = laneFiles.length;
  });
};

const fileCard = (file) => {
  const card = document.querySelector('#file-card-template').content.firstElementChild.cloneNode(true);
  card.querySelector('.file-icon').textContent = fileLabel(file);
  card.querySelector('strong').textContent = file.name;
  const resultText = file.kind === 'result' ? ' · 결과 파일' : '';
  card.querySelector('small').textContent = `${fileSize(file.size)}${resultText} · 업로드 ${uploadedAt(file.createdAt)}`;
  card.querySelector('.file-main').addEventListener('click', () => openPreview(file));
  const download = card.querySelector('.download-button');
  download.href = `/api/files/${file.id}/content?download=1`;
  download.download = file.name;
  card.querySelector('.delete-button').addEventListener('click', () => deleteFile(file));
  return card;
};

const loadFiles = async () => {
  const data = await request('/api/files');
  files = data.files;
  render();
};

const enter = async () => {
  try {
    session = await request('/api/session');
    gate.hidden = true;
    workspace.hidden = false;
    document.querySelector('#team-title').textContent = `${teamNames[session.team]} 작업공간`;
    await loadFiles();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadFiles().catch(() => {}), 4000);
  } catch {
    gate.hidden = false;
    workspace.hidden = true;
  }
};

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  entryError.textContent = '';
  try {
    await request('/api/session', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({team: teamSelect.value, eventCode: eventCode.value}),
    });
    eventCode.value = '';
    await enter();
  } catch (error) {
    entryError.textContent = error.message;
  }
});

document.querySelector('#leave').addEventListener('click', async () => {
  await request('/api/session', {method: 'DELETE'});
  clearInterval(refreshTimer);
  location.reload();
});

const uploadFiles = async (selected) => {
  for (const file of selected) {
    const form = new FormData();
    form.append('file', file);
    await request('/api/files', {method: 'POST', body: form});
  }
  showNotice(`${selected.length}개 파일을 안전하게 올렸어요.`);
  await loadFiles();
};

document.querySelector('#choose-files').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => uploadFiles([...fileInput.files]).catch((error) => showNotice(error.message)));
['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (event) => uploadFiles([...event.dataTransfer.files]).catch((error) => showNotice(error.message)));

const deleteFile = async (file) => {
  if (!confirm(`“${file.name}” 파일을 삭제할까요?\n삭제한 파일은 되돌릴 수 없어요.`)) return;
  await request(`/api/files/${file.id}`, {method: 'DELETE'});
  showNotice('파일을 삭제했어요.');
  await loadFiles();
};

const openPreview = async (file) => {
  preview.replaceChildren();
  previewTitle.textContent = file.name;
  const contentUrl = `/api/files/${file.id}/content`;
  downloadLink.href = `${contentUrl}?download=1`;
  downloadLink.download = file.name;
  if (['pdf'].includes(file.preview)) {
    preview.innerHTML = `<iframe title="${file.name}" src="${contentUrl}"></iframe>`;
  } else if (file.preview === 'image') {
    const image = new Image(); image.src = contentUrl; image.alt = file.name; preview.append(image);
  } else if (file.preview === 'video') {
    const video = document.createElement('video'); video.src = contentUrl; video.controls = true; preview.append(video);
  } else if (file.preview === 'audio') {
    const audio = document.createElement('audio'); audio.src = contentUrl; audio.controls = true; preview.append(audio);
  } else if (file.preview === 'text') {
    const pre = document.createElement('pre'); pre.textContent = await (await fetch(contentUrl)).text(); preview.append(pre);
  } else if (file.preview === 'office') {
    await openOffice(file);
  } else {
    const message = document.createElement('p');
    message.className = 'preview-message';
    message.textContent = '이 형식은 브라우저 미리보기를 지원하지 않아요. 원본 파일을 내려받아 확인해 주세요.';
    preview.append(message);
  }
  dialog.showModal();
};

const openOffice = async (file) => {
  const mount = document.createElement('div');
  mount.id = `office-${file.id}`;
  mount.style.cssText = 'width:100%;height:100%';
  preview.append(mount);
  if (!window.DocsAPI) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/web-apps/apps/api/documents/api.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('문서 편집기를 불러오지 못했습니다.'));
      document.head.append(script);
    });
  }
  const config = await request(`/api/onlyoffice/config/${file.id}`);
  window.openlabEditor?.destroyEditor?.();
  window.openlabEditor = new window.DocsAPI.DocEditor(mount.id, config);
};

document.querySelector('#close-preview').addEventListener('click', () => {
  window.openlabEditor?.destroyEditor?.();
  window.openlabEditor = null;
  dialog.close();
  loadFiles().catch(() => {});
});
dialog.addEventListener('cancel', () => {
  window.openlabEditor?.destroyEditor?.();
  window.openlabEditor = null;
});

document.querySelector('#show-guide').addEventListener('click', () => guideDialog.showModal());
document.querySelector('#close-guide').addEventListener('click', () => guideDialog.close());

enter();
