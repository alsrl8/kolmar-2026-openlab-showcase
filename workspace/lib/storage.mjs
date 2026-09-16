import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const EMPTY = {version: 1, files: []};

export class WorkspaceStorage {
  constructor(root) {
    this.root = path.resolve(root);
    this.filesRoot = path.join(this.root, 'files');
    this.metadataPath = path.join(this.root, 'metadata.json');
    this.lock = Promise.resolve();
  }

  async init() {
    await mkdir(this.filesRoot, {recursive: true});
    try {
      await stat(this.metadataPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.#writeMetadata(EMPTY);
    }
  }

  async list(team, filters = {}) {
    const data = await this.#readMetadata();
    return data.files
      .filter((file) => file.team === team)
      .filter((file) => !filters.status || file.status === filters.status)
      .filter((file) => !filters.kind || file.kind === filters.kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async all() {
    return (await this.#readMetadata()).files;
  }

  async get(id) {
    return (await this.#readMetadata()).files.find((file) => file.id === id) ?? null;
  }

  async create({team, name, mime, bytes, kind = 'original', sourceId = null, status}) {
    return this.#mutate(async (data) => {
      const id = randomUUID();
      const extension = path.extname(name).slice(0, 16);
      const storedName = `${id}${extension}`;
      const directory = path.join(this.filesRoot, team);
      await mkdir(directory, {recursive: true});
      await writeFile(path.join(directory, storedName), bytes, {flag: 'wx'});
      const now = new Date().toISOString();
      const file = {
        id,
        team,
        name,
        storedName,
        mime: mime || 'application/octet-stream',
        size: bytes.length,
        kind,
        sourceId,
        status: status ?? (kind === 'result' ? 'completed' : 'uploaded'),
        createdAt: now,
        updatedAt: now,
      };
      data.files.push(file);
      return file;
    });
  }

  async update(id, patch) {
    return this.#mutate(async (data) => {
      const file = data.files.find((candidate) => candidate.id === id);
      if (!file) return null;
      Object.assign(file, patch, {updatedAt: new Date().toISOString()});
      return file;
    });
  }

  async content(file) {
    return readFile(path.join(this.filesRoot, file.team, file.storedName));
  }

  async clear() {
    return this.#mutate(async (data) => {
      await rm(this.filesRoot, {recursive: true, force: true});
      await mkdir(this.filesRoot, {recursive: true});
      const removed = data.files.length;
      data.files = [];
      return {removed};
    });
  }

  async #readMetadata() {
    return JSON.parse(await readFile(this.metadataPath, 'utf8'));
  }

  async #writeMetadata(data) {
    const temporaryPath = `${this.metadataPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
    await rename(temporaryPath, this.metadataPath);
  }

  async #mutate(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const data = await this.#readMetadata();
      const result = await operation(data);
      await this.#writeMetadata(data);
      return result;
    } finally {
      release();
    }
  }
}
