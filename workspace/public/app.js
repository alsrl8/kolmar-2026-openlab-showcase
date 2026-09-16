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
const mindmapElement = document.querySelector('#mindmap');
const editMindmapButton = document.querySelector('#edit-mindmap');
const saveMindmapButton = document.querySelector('#save-mindmap');
const cancelMindmapButton = document.querySelector('#cancel-mindmap');
let session = null;
let files = [];
let mindmap = null;
let mindmapSnapshot = null;
let mindmapEditing = false;
let mindmapSaveChain = Promise.resolve();
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

const editable = (element, role) => {
  element.dataset.role = role;
  element.contentEditable = mindmapEditing ? 'true' : 'false';
  element.spellcheck = false;
  return element;
};

const mindmapItem = (item, branch) => {
  const row = document.createElement('label');
  row.className = 'mindmap-item';
  row.dataset.id = item.id;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = item.checked;
  checkbox.addEventListener('change', () => {
    mindmap = collectMindmap();
    queueMindmapSave('체크 상태를 저장했어요.');
  });
  const text = editable(document.createElement('span'), 'item-text');
  text.textContent = item.text;
  const remove = document.createElement('button');
  remove.className = 'mindmap-delete';
  remove.type = 'button';
  remove.setAttribute('aria-label', '항목 삭제');
  remove.textContent = '×';
  remove.addEventListener('click', (event) => {
    event.preventDefault();
    if (branch.items.length <= 1) return showNotice('가지에는 항목이 하나 이상 필요해요.');
    branch.items = branch.items.filter((candidate) => candidate.id !== item.id);
    renderMindmap();
  });
  row.append(checkbox, text, remove);
  return row;
};

const renderMindmap = () => {
  if (!mindmap) return;
  const root = document.createElement('div');
  root.className = 'mindmap-root';
  const title = editable(document.createElement('h3'), 'title');
  title.textContent = mindmap.title;
  const subtitle = editable(document.createElement('p'), 'subtitle');
  subtitle.textContent = mindmap.subtitle;
  root.append(title, subtitle);

  const branches = document.createElement('div');
  branches.className = 'mindmap-branches';
  mindmap.branches.forEach((branch) => {
    const article = document.createElement('article');
    article.className = 'mindmap-branch';
    article.dataset.id = branch.id;
    const heading = editable(document.createElement('h4'), 'branch-title');
    heading.textContent = branch.title;
    const items = document.createElement('div');
    items.className = 'mindmap-items';
    items.replaceChildren(...branch.items.map((item) => mindmapItem(item, branch)));
    const add = document.createElement('button');
    add.className = 'mindmap-add';
    add.type = 'button';
    add.textContent = '＋ 항목 추가';
    add.addEventListener('click', () => {
      if (branch.items.length >= 12) return showNotice('한 가지에는 항목을 12개까지 추가할 수 있어요.');
      mindmap = collectMindmap();
      const target = mindmap.branches.find((candidate) => candidate.id === branch.id);
      target.items.push({id: `item_${crypto.randomUUID().replaceAll('-', '')}`, text: '새 확인 항목', checked: false});
      renderMindmap();
    });
    article.append(heading, items, add);
    branches.append(article);
  });
  mindmapElement.classList.toggle('editing', mindmapEditing);
  mindmapElement.replaceChildren(root, branches);
};

const collectMindmap = () => ({
  title: mindmapElement.querySelector('[data-role="title"]').textContent.trim(),
  subtitle: mindmapElement.querySelector('[data-role="subtitle"]').textContent.trim(),
  branches: [...mindmapElement.querySelectorAll('.mindmap-branch')].map((branch) => ({
    id: branch.dataset.id,
    title: branch.querySelector('[data-role="branch-title"]').textContent.trim(),
    items: [...branch.querySelectorAll('.mindmap-item')].map((item) => ({
      id: item.dataset.id,
      text: item.querySelector('[data-role="item-text"]').textContent.trim(),
      checked: item.querySelector('input').checked,
    })),
  })),
});

const persistMindmap = async (message) => {
  const data = await request('/api/mindmap', {
    method: 'PUT',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({mindmap}),
  });
  mindmap = data.mindmap;
  if (message) showNotice(message);
};

const queueMindmapSave = (message) => {
  mindmapSaveChain = mindmapSaveChain.then(() => persistMindmap(message)).catch((error) => showNotice(error.message));
  return mindmapSaveChain;
};

const loadMindmap = async () => {
  mindmap = (await request('/api/mindmap')).mindmap;
  renderMindmap();
};

editMindmapButton.addEventListener('click', () => {
  mindmapSnapshot = structuredClone(mindmap);
  mindmapEditing = true;
  editMindmapButton.hidden = true;
  saveMindmapButton.hidden = false;
  cancelMindmapButton.hidden = false;
  renderMindmap();
});

saveMindmapButton.addEventListener('click', async () => {
  try {
    mindmap = collectMindmap();
    await persistMindmap('마인드맵을 저장했어요.');
    mindmapEditing = false;
    editMindmapButton.hidden = false;
    saveMindmapButton.hidden = true;
    cancelMindmapButton.hidden = true;
    renderMindmap();
  } catch (error) {
    showNotice(error.message);
  }
});

cancelMindmapButton.addEventListener('click', () => {
  mindmap = mindmapSnapshot;
  mindmapEditing = false;
  editMindmapButton.hidden = false;
  saveMindmapButton.hidden = true;
  cancelMindmapButton.hidden = true;
  renderMindmap();
});

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
    await Promise.all([loadFiles(), loadMindmap()]);
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
