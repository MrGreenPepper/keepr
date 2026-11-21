// Project data (.keepr/data.json) and the project registry.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, OLD_CONFIG_DIR, REGISTRY } from './config.mjs';

// ---------------------------------------------------------------- storage

export const now = () => new Date().toISOString();

function emptyData(name) {
  return { version: 1, name, counters: { A: 0, T: 0, I: 0, B: 0 }, answers: [], tasks: [], inbox: [], plan: [] };
}

// New projects use .keepr/; projects created before the rename keep their .workflow/ folder.
export function dataFile(root) {
  const old = path.join(root, '.workflow', 'data.json');
  const file = path.join(root, '.keepr', 'data.json');
  return !fs.existsSync(file) && fs.existsSync(old) ? old : file;
}

export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(dataFile(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// New project: git root if there is one, otherwise the current directory.
export function defaultProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function initProject(root) {
  const file = dataFile(root);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeData(root, emptyData(path.basename(root)));
  }
  register(root);
  return root;
}

export function readData(root) {
  const d = JSON.parse(fs.readFileSync(dataFile(root), 'utf8'));
  d.counters ??= { A: 0, T: 0 };
  d.counters.I ??= 0;
  d.counters.B ??= 0;
  d.answers ??= [];
  d.tasks ??= [];
  d.inbox ??= [];
  d.plan ??= [];
  for (const t of d.tasks) {
    t.links ??= [];
    for (const st of t.subtasks || []) {
      st.status ??= st.done ? 'done' : 'todo';
      st.description ??= '';
    }
  }
  return d;
}

function writeData(root, data) {
  const file = dataFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Reads fresh, applies fn, writes back atomically.
export function mutate(root, fn) {
  const data = readData(root);
  const result = fn(data);
  writeData(root, data);
  return result;
}

export function readRegistry() {
  // One-time move of the project list from ~/.config/wf (before the rename).
  const old = path.join(OLD_CONFIG_DIR, 'projects.json');
  if (!fs.existsSync(REGISTRY) && fs.existsSync(old)) {
    try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.copyFileSync(old, REGISTRY); } catch {}
  }
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return []; }
}

export function register(root) {
  const list = readRegistry().filter(p => fs.existsSync(dataFile(p.path)));
  if (!list.some(p => p.path === root)) list.push({ path: root, name: path.basename(root) });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(list, null, 2));
}
