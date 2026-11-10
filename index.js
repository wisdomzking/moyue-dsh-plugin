/**
 * 墨阅 · 本地电子书阅读器 —— Host 半。
 *
 * 客户端半在左侧栏注册「墨阅」入口，主区域用 iframe 嵌入本机阅读器
 * （http://127.0.0.1:7788）。本文件负责：DSH 启动时确保阅读器服务在跑；
 * 服务意外退出时自动拉起（15s 健康检查）；插件卸载时只关闭自己拉起的进程。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DEFAULT_APP_ROOT = 'D:\\tools\\dsh\\ebook-reader';
const DEFAULT_PORT = 7788;
const DEFAULT_AI_PORT = 7797;
const CHECK_INTERVAL = 15000;
const START_TIMEOUT = 12000;

const APP_ROOT = (process.env.MOYUE_APP_ROOT || DEFAULT_APP_ROOT).trim();
const PORT = Number(process.env.MOYUE_PORT) || DEFAULT_PORT;
const AI_PORT = Number(process.env.MOYUE_AI_PORT) || DEFAULT_AI_PORT;
const SERVER_ENTRY = path.join(APP_ROOT, 'server', 'server.js');
const AI_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
let aiBusy = false;

function isUp() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 900 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function nodeCandidates() {
  const list = [];
  if (process.env.MOYUE_NODE) list.push({ cmd: process.env.MOYUE_NODE, env: {} });
  if (process.platform === 'win32') {
    const bundled = 'C:\\Program Files\\nodejs\\node.exe';
    if (fs.existsSync(bundled)) list.push({ cmd: bundled, env: {} });
  }
  list.push({ cmd: 'node', env: {} });
  // Electron's own binary can act as Node with this flag; last resort.
  list.push({ cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } });
  return list;
}

function startServer(ctx, onSpawn) {
  return new Promise((resolve) => {
    const candidates = nodeCandidates();
    let index = 0;
    let settled = false;
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      resolve(ok ? detail : null);
    };

    const tryNext = () => {
      if (index >= candidates.length) return finish(false);
      const { cmd, env } = candidates[index++];
      let child;
      try {
        child = spawn(cmd, [SERVER_ENTRY, '--port', String(PORT)], {
          cwd: APP_ROOT,
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          env: { ...process.env, ...env, MOYUE_LAUNCHED_BY: 'dsh-plugin' },
        });
      } catch (err) {
        console.warn('[moyue-reader] spawn failed:', cmd, err && err.message);
        return tryNext();
      }
      let exited = false;
      child.on('error', (err) => {
        exited = true;
        console.warn('[moyue-reader] spawn error:', cmd, err && err.message);
        tryNext();
      });
      child.on('exit', (code) => {
        exited = true;
        if (!settled) {
          console.warn('[moyue-reader] server exited early:', cmd, 'code', code);
          tryNext();
        }
      });
      if (typeof child.unref === 'function') child.unref();
      // Report the pid immediately: the plugin may be disposed while the server
      // is still starting, and the cleanup must be able to stop it.
      if (typeof onSpawn === 'function') onSpawn({ pid: child.pid, cmd });

      const started = Date.now();
      const poll = async () => {
        if (settled) return;
        if (await isUp()) return finish(true, { pid: child.pid, cmd });
        if (exited && index < candidates.length) return;
        if (Date.now() - started > START_TIMEOUT) {
          console.warn('[moyue-reader] server did not become healthy in time:', cmd);
          try {
            if (!exited && child.pid) process.kill(child.pid);
          } catch (_) { /* ignore */ }
          return tryNext();
        }
        setTimeout(poll, 400);
      };
      setTimeout(poll, 400);
    };
    tryNext();
  });
}

/* ======================= AI 章节导读代理 ======================= */

function currentModelRoute(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
    if (selection && selection.provider && selection.model) {
      return { provider: selection.provider, model: selection.model };
    }
  } catch (_) { /* fall through */ }
  return { provider: 'deepseek-account', model: 'deepseek-flash' };
}

function readBody(req, limit = 400000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...AI_CORS });
  res.end(body);
}

function buildGuidePrompt(input) {
  const bookTitle = String(input.bookTitle || '未知书名').slice(0, 200);
  const chapterTitle = String(input.chapterTitle || '当前章节').slice(0, 200);
  const mode = input.mode === 'page' ? '当前页面' : '当前章节';
  let text = String(input.text || '').replace(/\r\n/g, '\n').trim();
  const MAX = 14000;
  if (text.length > MAX) {
    text = `${text.slice(0, MAX * 0.7)}\n\n……（中间内容因长度省略）……\n\n${text.slice(-MAX * 0.3)}`;
  }
  return {
    system: [
      '你是一位严谨的中文阅读教练与知识提炼专家，擅长把一章内容压缩成可吸收的结构化导读。',
      '必须忠于原文：只依据用户提供的原文进行概括和分析，不编造人物、数据、引文或情节；原文没有明确给出的判断要标注“推测”。',
      '只输出一个严格的 JSON 对象，不要 Markdown 代码块，不要任何解释性前后缀。',
    ].join('\n'),
    user: [
      `书名：《${bookTitle}》`,
      `当前${mode}：${chapterTitle}`,
      '',
      '原文如下（可能因长度被截断）：',
      '"""',
      text,
      '"""',
      '',
      '请阅读后输出如下 JSON 结构（字段必须齐全）：',
      '{',
      '  "chapterTitle": "本章标题（可与原文标题一致）",',
      '  "summary": "150-250 字摘要，按原文顺序概括本章主要内容与信息",',
      '  "guide": "80-150 字导读：本章在全书中的位置、作者意图、阅读时应带着的问题",',
      '  "structure": {',
      '    "thesis": "本章核心论点或主旨（1-2 句）",',
      '    "keyPoints": ["关键要点，4-7 条，每条 20-50 字"],',
      '    "flow": ["作者的展开脉络或论证步骤，3-6 步"],',
      '    "concepts": [{"term": "概念或术语", "explain": "简明解释（30-60 字）"}]',
      '  },',
      '  "questions": ["由浅入深的思考问题，4-6 个，避免是非题"],',
      '  "keywords": ["关键词，5-8 个"]',
      '}',
      '',
      '写作要求：全部使用中文，专有名词保留原文；如果原文开头有明显标题，请以原文标题为准写入 chapterTitle；questions 要能帮助读者把本章知识与自身经验、其他章节或现实问题建立联系；如原文是英文，用中文解读但保留关键人名与术语。',
    ].join('\n'),
  };
}

function normalizeGuide(raw, fallbackTitle) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const structure = source.structure && typeof source.structure === 'object' ? source.structure : {};
  const strings = (value, max) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item == null ? '' : item).trim())
      .filter(Boolean)
      .slice(0, max);
  const concepts = (Array.isArray(structure.concepts) ? structure.concepts : [])
    .map((item) => ({
      term: String((item && item.term) || '').trim(),
      explain: String((item && item.explain) || '').trim(),
    }))
    .filter((item) => item.term)
    .slice(0, 8);
  const guide = {
    chapterTitle: String(source.chapterTitle || fallbackTitle || '').trim(),
    summary: String(source.summary || '').trim(),
    guide: String(source.guide || '').trim(),
    structure: {
      thesis: String(structure.thesis || '').trim(),
      keyPoints: strings(structure.keyPoints, 8),
      flow: strings(structure.flow, 8),
      concepts,
    },
    questions: strings(source.questions, 8),
    keywords: strings(source.keywords, 12),
  };
  if (!guide.summary && !guide.guide) throw new Error('模型没有返回有效的导读内容');
  return guide;
}

/* ---------------- AI 书架分类 ---------------- */

function buildClassifyPrompt(books) {
  const lines = books.map((book, index) => {
    const title = String(book.title || '').slice(0, 120);
    const author = String(book.author || '').slice(0, 60);
    const format = String(book.format || '').slice(0, 20);
    return `${index + 1}. ${JSON.stringify(book.id)} | 《${title}》 | ${author || '未知作者'} | ${format}`;
  });
  return {
    system: [
      '你是一位中文图书整理专家。请根据书籍的标题、作者和格式，把用户书架上的书按“主题/领域”分成若干文件夹。',
      '只输出一个严格的 JSON 对象，不要 Markdown 代码块，不要解释。',
      '分组要实用、互斥：例如销售与营销、管理与领导力、思维与认知、沟通与谈判、个人成长、经济与商业、文学与人文、技术与其他。',
      '每个书 id 必须原样使用清单里的字符串（含引号内的完整 id），每本书只能出现在一个组里。',
    ].join('\n'),
    user: [
      '书架书籍清单（格式：序号. "书id" | 书名 | 作者 | 格式）：',
      lines.join('\n'),
      '',
      '请输出如下 JSON：',
      '{',
      '  "folders": [',
      '    {"name": "2-8 个字的中文文件夹名", "description": "一句话说明本组主题", "bookIds": ["书id", "..."]}',
      '  ]',
      '}',
      '',
      '要求：',
      '- 最多 8 个文件夹，尽量让每个文件夹至少 1 本书；',
      '- 分组按主题而不是格式或作者；无法归类的书放进「其他」；',
      '- 不要遗漏书籍，不要把一本书放进多个文件夹；',
      '- 文件夹名要短、可读、互不重复。',
    ].join('\n'),
  };
}

function parseBookGroups(text, validIds) {
  let value = String(text || '').trim();
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型返回内容不是 JSON');
  const parsed = JSON.parse(value.slice(start, end + 1));
  const rawFolders = Array.isArray(parsed && parsed.folders) ? parsed.folders : [];
  const seen = new Set();
  const folders = [];
  for (const raw of rawFolders) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) continue;
    const bookIds = [];
    for (const id of Array.isArray(raw.bookIds) ? raw.bookIds : []) {
      const clean = String(id || '').trim();
      if (!validIds.has(clean) || seen.has(clean)) continue;
      seen.add(clean);
      bookIds.push(clean);
    }
    if (!bookIds.length) continue;
    folders.push({ name, description: String(raw.description || '').slice(0, 80), bookIds });
    if (folders.length >= 10) break;
  }
  if (!folders.length) throw new Error('模型没有返回有效的分组结果');
  return folders;
}

async function classifyBooks(ctx, books) {
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') {
    throw Object.assign(new Error('DSH 模型服务不可用（llm service 未加载）'), { code: 'NO_LLM' });
  }
  const route = currentModelRoute(ctx);
  const prompt = buildClassifyPrompt(books);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let text = '';
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: prompt.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
      temperature: 0.3,
      maxTokens: 4000,
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text || '';
      else if (chunk.type === 'finish') {
        const kind = chunk.reason && chunk.reason.kind;
        if (kind === 'error') throw new Error((chunk.reason.failure && chunk.reason.failure.message) || '模型调用失败');
        if (kind === 'aborted') throw new Error('模型调用已取消或超时');
        if (kind === 'max-tokens') throw new Error('模型输出达到长度上限，请减少书籍数量后重试');
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const validIds = new Set(books.map((book) => String(book.id)));
  const folders = parseBookGroups(text, validIds);
  return { folders, model: route };
}


function parseGuideJson(text) {
  let value = String(text || '').trim();
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型返回内容不是 JSON');
  return JSON.parse(value.slice(start, end + 1));
}

async function generateGuide(ctx, input) {
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') {
    throw Object.assign(new Error('DSH 模型服务不可用（llm service 未加载）'), { code: 'NO_LLM' });
  }
  const route = currentModelRoute(ctx);
  const prompt = buildGuidePrompt(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let text = '';
  let usage = null;
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: prompt.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
      temperature: 0.4,
      maxTokens: 6000,
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text || '';
      else if (chunk.type === 'usage') usage = chunk.usage || usage;
      else if (chunk.type === 'finish') {
        const kind = chunk.reason && chunk.reason.kind;
        if (kind === 'error') throw new Error((chunk.reason.failure && chunk.reason.failure.message) || '模型调用失败');
        if (kind === 'aborted') throw new Error('模型调用已取消或超时');
        if (kind === 'max-tokens') throw new Error('模型输出达到长度上限被截断，请重试（或缩短章节内容）');
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!text.trim()) throw new Error('模型没有返回内容');
  let parsed;
  try {
    parsed = parseGuideJson(text);
  } catch (err) {
    try {
      fs.mkdirSync(path.join(APP_ROOT, 'data'), { recursive: true });
      fs.writeFileSync(path.join(APP_ROOT, 'data', 'ai-debug.txt'), text, 'utf8');
    } catch (_) { /* ignore */ }
    throw err;
  }
  const guide = normalizeGuide(parsed, input.chapterTitle);
  return { guide, model: route, usage, rawLength: text.length };
}

async function handleAiRequest(ctx, req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, AI_CORS);
    res.end();
    return;
  }
  const origin = req.headers.origin;
  // 仅允许阅读器本机页面调用，避免其它本地网页消耗模型额度
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):7788$/i.test(origin)) {
    sendJson(res, 403, { ok: false, error: { code: 'ORIGIN_DENIED', message: '不允许的调用来源' } });
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    const route = currentModelRoute(ctx);
    sendJson(res, 200, { ok: true, service: 'moyue-ai', provider: route.provider, model: route.model });
    return;
  }
  const isGuide = url.pathname === '/chapter-guide';
  const isClassify = url.pathname === '/classify-books';
  if ((!isGuide && !isClassify) || req.method !== 'POST') {
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
    return;
  }
  if (aiBusy) {
    sendJson(res, 429, { ok: false, error: { code: 'BUSY', message: 'AI 正在处理上一个请求，请稍候' } });
    return;
  }
  aiBusy = true;
  try {
    const raw = await readBody(req);
    const input = JSON.parse(raw || '{}');
    if (isClassify) {
      const books = (Array.isArray(input.books) ? input.books : [])
        .slice(0, 300)
        .map((book) => ({
          id: String((book && book.id) || '').trim(),
          title: String((book && book.title) || '').slice(0, 160),
          author: String((book && book.author) || '').slice(0, 80),
          format: String((book && book.format) || '').slice(0, 20),
        }))
        .filter((book) => book.id);
      if (!books.length) {
        sendJson(res, 400, { ok: false, error: { code: 'NO_BOOKS', message: '没有可分类的书籍' } });
        return;
      }
      const result = await classifyBooks(ctx, books);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    const text = String(input.text || '');
    if (text.trim().length < 30) {
      sendJson(res, 400, { ok: false, error: { code: 'TEXT_TOO_SHORT', message: '当前章节内容太少，无法生成导读' } });
      return;
    }
    const result = await generateGuide(ctx, {
      bookTitle: input.bookTitle,
      chapterTitle: input.chapterTitle,
      mode: input.mode,
      text,
    });
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.warn('[moyue-reader] AI request failed:', err && err.message ? err.message : err);
    sendJson(res, 502, {
      ok: false,
      error: {
        code: err && err.code ? err.code : 'GENERATE_FAILED',
        message: err && err.message ? err.message : 'AI 处理失败',
      },
    });
  } finally {
    aiBusy = false;
  }
}

function startAiProxy(ctx) {
  const server = http.createServer((req, res) => {
    handleAiRequest(ctx, req, res).catch((err) => {
      try {
        sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: String(err) } });
      } catch (_) { /* ignore */ }
    });
  });
  server.on('error', (err) => {
    console.warn('[moyue-reader] AI proxy listen failed:', err && err.message ? err.message : err);
  });
  server.listen(AI_PORT, '127.0.0.1', () => {
    console.log(`[moyue-reader] AI chapter guide proxy → http://127.0.0.1:${AI_PORT}`);
  });
  return () => {
    try { server.close(); } catch (_) { /* ignore */ }
  };
}

export function apply(ctx) {
  ctx.effect(() => startAiProxy(ctx), 'moyue-reader: AI chapter guide proxy');
  ctx.effect(() => {
    let stopped = false;
    let ownPid = null;
    let checking = false;

    const check = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        if (await isUp()) return;
        if (!fs.existsSync(SERVER_ENTRY)) {
          console.warn('[moyue-reader] reader server not found at', SERVER_ENTRY);
          return;
        }
        const started = await startServer(ctx, (info) => {
          if (!info || !info.pid) return;
          if (stopped) {
            try { process.kill(info.pid); } catch (_) { /* already gone */ }
            return;
          }
          ownPid = info.pid;
        });
        if (started && !ownPid) ownPid = started.pid;
        if (ownPid) console.log('[moyue-reader] reader server started, pid', ownPid, 'port', PORT);
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL);

    return () => {
      stopped = true;
      clearInterval(timer);
      if (ownPid) {
        try {
          process.kill(ownPid);
          console.log('[moyue-reader] reader server stopped, pid', ownPid);
        } catch (_) { /* already gone */ }
        ownPid = null;
      }
    };
  }, 'moyue-reader: local reader server watchdog');
}
