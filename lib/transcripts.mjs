// Claude adapter: reads Claude Code transcripts for `keepr save`. Optional – the core does not need it.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_PROJECTS } from './config.mjs';

export function firstLine(s) {
  const line = (s || '').split('\n').map(l => l.replace(/^[#>*\-\s`]+/, '').trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}

// ---------------------------------------------------------------- Claude transcripts

export function sessionTranscript(session) {
  if (!fs.existsSync(CLAUDE_PROJECTS)) return null;
  for (const dir of fs.readdirSync(CLAUDE_PROJECTS)) {
    const f = path.join(CLAUDE_PROJECTS, dir, `${session}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

export function latestTranscript(cwd) {
  const dir = path.join(CLAUDE_PROJECTS, path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0]?.f || null;
}

function cleanPrompt(text) {
  return text
    .replace(/<(system-reminder|ide_opened_file|ide_selection|ide_diagnostics)>[\s\S]*?<\/\1>/g, '')
    .replace(/<command-(name|message|args)>([\s\S]*?)<\/command-\1>/g, (_, k, v) => (k === 'args' ? v : k === 'name' ? v + ' ' : ''))
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted text]')
    .trim();
}

// Splits a transcript into turns: user prompt + the AI's final answer.
export function parseTurns(file) {
  const turns = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    const content = e.message?.content;
    if (e.type === 'user' && !e.isMeta) {
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content || [];
      if (blocks.some(b => b.type === 'tool_result')) continue;
      const prompt = cleanPrompt(blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'));
      if (!prompt) continue;
      cur = { prompt, uuid: e.uuid, at: e.timestamp, all: [], tail: [], tailUuid: null };
      turns.push(cur);
    } else if (e.type === 'assistant' && cur && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use') cur.tail = [];
        if (b.type === 'text' && b.text.trim()) {
          if (!cur.tail.length) cur.tailUuid = e.uuid;
          cur.tail.push(b.text);
          cur.all.push(b.text);
        }
      }
    }
  }
  return turns.map(t => ({ prompt: t.prompt, uuid: t.uuid, at: t.at, answer: t.tail.join('\n\n'), full: t.all.join('\n\n'), answerUuid: t.tailUuid }));
}
