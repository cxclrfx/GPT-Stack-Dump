(async () => {
  "use strict";

  const APP = "ChatGPT History Exporter";
  const VERSION = "1.0.1";
  const DB_NAME = "chatgpt-history-exporter-v1.0.1";
  const DB_VERSION = 1;
  const STORE = "conversations";

  const CONFIG = {
    listLimit: 100,
    turnsPerPage: 100,
    baseDelayMs: 700,
    recoveryDelayMs: 8000,
    successWindow: 5,
    jitterFraction: 0.15,
    rateLimitBackoffSeconds: [12, 40, 75, 120, 180, 240, 300, 300],
    serverErrorBackoffSeconds: [12, 30, 60, 120],
    tryProjects: true,
  };

  const log = (...args) => console.log(`[${APP}]`, ...args);
  const warn = (...args) => console.warn(`[${APP}]`, ...args);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function jitter(ms) {
    const f = CONFIG.jitterFraction;
    const factor = 1 + (Math.random() * 2 - 1) * f;
    return Math.max(0, Math.round(ms * factor));
  }

  function retryAfterMs(response) {
    const raw = response.headers.get("Retry-After");
    if (!raw) return null;

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }

    const absolute = Date.parse(raw);
    if (Number.isFinite(absolute)) {
      return Math.max(0, absolute - Date.now());
    }

    return null;
  }

  class RateController {
    constructor() {
      this.delayMs = CONFIG.baseDelayMs;
      this.successStreak = 0;
      this.rateLimitLevel = 0;
    }

    async afterSuccess() {
      this.successStreak += 1;

      if (this.successStreak >= CONFIG.successWindow) {
        this.successStreak = 0;
        this.rateLimitLevel = Math.max(0, this.rateLimitLevel - 1);

        if (this.delayMs > CONFIG.baseDelayMs) {
          this.delayMs = Math.max(
            CONFIG.baseDelayMs,
            Math.round(this.delayMs * 0.65)
          );
        }
      }

      await sleep(jitter(this.delayMs));
    }

    async onRateLimit(response, attempt) {
      this.successStreak = 0;
      this.rateLimitLevel = Math.min(
        this.rateLimitLevel + 1,
        CONFIG.rateLimitBackoffSeconds.length - 1
      );
      this.delayMs = Math.max(this.delayMs, CONFIG.recoveryDelayMs);

      const serverWait = retryAfterMs(response);
      const fallbackSeconds =
        CONFIG.rateLimitBackoffSeconds[
          Math.min(attempt, CONFIG.rateLimitBackoffSeconds.length - 1)
        ];

      const waitMs = Math.max(serverWait || 0, fallbackSeconds * 1000);

      warn(
        `HTTP 429. Circuit open: no requests for ~${Math.round(
          waitMs / 1000
        )} seconds.`
      );

      await sleep(Math.max(serverWait || 0, jitter(waitMs)));
    }

    async onServerError(status, attempt) {
      this.successStreak = 0;
      const seconds =
        CONFIG.serverErrorBackoffSeconds[
          Math.min(attempt, CONFIG.serverErrorBackoffSeconds.length - 1)
        ];

      warn(`HTTP ${status}. Waiting ~${seconds} seconds before retry.`);
      await sleep(jitter(seconds * 1000));
    }
  }

  const rate = new RateController();

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "conversation_id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGet(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function dbPut(db, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function getAccessToken() {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Unable to read current session: HTTP ${response.status}`);
    }

    const session = await response.json();
    const token = session.accessToken || session.access_token || session.token;

    if (!token) {
      throw new Error(
        "No access token was exposed by /api/auth/session. Reload ChatGPT and try again."
      );
    }

    return token;
  }

  async function fetchJSON(url, headers, options = {}) {
    const { retry5xx = true } = options;
    let attempt429 = 0;
    let attempt5xx = 0;

    while (true) {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers,
        cache: "no-store",
      });

      if (response.ok) {
        const data = await response.json();
        await rate.afterSuccess();
        return data;
      }

      if (response.status === 429) {
        await rate.onRateLimit(response, attempt429);
        attempt429 += 1;
        continue;
      }

      if (
        retry5xx &&
        [408, 500, 502, 503, 504].includes(response.status)
      ) {
        await rate.onServerError(response.status, attempt5xx);
        attempt5xx += 1;
        continue;
      }

      throw new Error("Request failed: HTTP " + response.status);
    }
  }

  function extractItems(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.conversations)) return data.conversations;
    throw new Error("Unrecognized list response.");
  }

  async function listConversations(headers, isArchived) {
    const result = [];
    let offset = 0;
    const seenIds = new Set();

    while (true) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(CONFIG.listLimit),
        order: "updated",
        is_archived: isArchived ? "true" : "false",
      });

      const data = await fetchJSON(
        `/backend-api/conversations?${params.toString()}`,
        headers
      );

      const items = extractItems(data);
      if (!items.length) {
        if (data?.has_more === true || data?.hasMore === true ||
            (data?.total != null && Number(data.total) > offset)) {
          throw new Error("Empty list page still reports more conversations.");
        }
        break;
      }

      for (const item of items) {
        const id = item?.id || item?.conversation_id;
        if (typeof id !== "string" || !id || seenIds.has(id)) {
          throw new Error("Missing or repeated conversation ID while indexing.");
        }
        seenIds.add(id);
      }
      result.push(...items);
      offset += items.length;

      log(
        `${isArchived ? "Archived" : "Regular"} conversations indexed: ${
          result.length
        }`
      );

      const hasMore =
        typeof data?.has_more === "boolean"
          ? data.has_more
          : typeof data?.hasMore === "boolean"
          ? data.hasMore
          : Number.isFinite(Number(data?.total))
          ? offset < Number(data.total)
          : items.length >= CONFIG.listLimit;

      if (!hasMore) break;
    }

    return result;
  }

  async function listProjects(headers) {
    if (!CONFIG.tryProjects) return [];

    const projects = [];
    let cursor = "0";
    const seen = new Set();

    while (true) {
      const params = new URLSearchParams({
        owned_only: "true",
        conversations_per_gizmo: "0",
        cursor,
      });

      let data;
      try {
        data = await fetchJSON(
          `/backend-api/gizmos/snorlax/sidebar?${params.toString()}`,
          headers,
          { retry5xx: false }
        );
      } catch (error) {
        warn(
          "Projects endpoint is unavailable in this ChatGPT build. Continuing without Projects.",
          error.message
        );
        return projects;
      }

      for (const item of extractItems(data)) {
        const wrapper = item?.gizmo || {};
        const project = wrapper?.gizmo || wrapper;
        const id = project?.id || wrapper?.id || item?.id;
        if (!id) continue;

        projects.push({
          id,
          name: project?.display?.name || project?.name || "Unnamed Project",
        });
      }

      const next = data?.cursor;
      if (!next) break;
      if (seen.has(next) || next === cursor) throw new Error("Repeated project cursor.");
      seen.add(next);
      cursor = next;
    }

    return [...new Map(projects.map((p) => [p.id, p])).values()];
  }

  async function listProjectConversations(headers, project) {
    const result = [];
    let cursor = "0";
    const seen = new Set();

    while (true) {
      const params = new URLSearchParams({ cursor });
      const data = await fetchJSON(
        `/backend-api/gizmos/${encodeURIComponent(
          project.id
        )}/conversations?${params.toString()}`,
        headers
      );

      for (const item of extractItems(data)) {
        result.push({
          ...item,
          _project_id: project.id,
          _project_name: project.name,
        });
      }

      const next = data?.cursor;
      if (!next) break;
      if (seen.has(next) || next === cursor) throw new Error("Repeated project cursor.");
      seen.add(next);
      cursor = next;
    }

    return result;
  }

  async function fetchConversation(headers, id) {
    const pages = [];
    const seenCursors = new Set();
    let before = null;
    let metadata = null;

    while (true) {
      const params = new URLSearchParams({
        include_has_versions: "true",
        num_turns: String(CONFIG.turnsPerPage),
      });

      if (before) params.set("before", before);

      const data = await fetchJSON(
        `/backend-api/conversations/${encodeURIComponent(
          id
        )}?${params.toString()}`,
        headers
      );

      if (data?.conversation_id != null && data.conversation_id !== id) {
        throw new Error("Conversation identity mismatch.");
      }
      if (!Array.isArray(data?.messages)) {
        throw new Error(`Conversation ${id} did not return a messages array.`);
      }

      if (!metadata) {
        metadata = { ...data };
        delete metadata.messages;
        delete metadata.page_info;
      }

      pages.push(data.messages);

      const pageInfo = data?.page_info;
      if (typeof pageInfo?.has_previous_page !== "boolean") {
        throw new Error("Missing pagination completion evidence.");
      }
      if (!pageInfo.has_previous_page) break;
      if (typeof pageInfo.start_cursor !== "string" || !pageInfo.start_cursor ||
          seenCursors.has(pageInfo.start_cursor)) {
        throw new Error("Incomplete pagination: missing or repeated cursor.");
      }

      seenCursors.add(pageInfo.start_cursor);
      before = pageInfo.start_cursor;
    }

    const messages = [];
    const seenMessages = new Set();

    for (const page of pages.slice().reverse()) {
      for (const message of page) {
        const key = message?.id || JSON.stringify(message);
        if (seenMessages.has(key)) {
          const previous = messages.find((m) => (m?.id || JSON.stringify(m)) === key);
          if (JSON.stringify(previous) !== JSON.stringify(message)) {
            throw new Error("Conflicting message versions across pages.");
          }
          continue;
        }
        seenMessages.add(key);
        messages.push(message);
      }
    }

    return {
      ...metadata,
      conversation_id: metadata?.conversation_id || id,
      messages,
      _exporter: {
        version: VERSION,
        pages_merged: pages.length,
        message_objects: messages.length,
        exported_at: new Date().toISOString(),
      },
    };
  }

  function addToIndex(index, item, source) {
    const id = item?.id || item?.conversation_id;
    if (!id) return;

    const existing = index.get(id) || {
      id,
      title: item?.title || "Untitled Conversation",
      create_time: item?.create_time || null,
      update_time: item?.update_time || null,
      is_archived: Boolean(item?.is_archived),
      project_id: item?._project_id || item?.gizmo_id || null,
      project_name: item?._project_name || null,
      sources: [],
    };

    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (item?.title) existing.title = item.title;
    if (item?.create_time) existing.create_time = item.create_time;
    if (item?.update_time) existing.update_time = item.update_time;
    if (item?.is_archived) existing.is_archived = true;
    if (item?._project_id) existing.project_id = item._project_id;
    if (item?._project_name) existing.project_name = item._project_name;

    index.set(id, existing);
  }

  async function buildIndex(headers) {
    const index = new Map();

    const regular = await listConversations(headers, false);
    regular.forEach((item) => addToIndex(index, item, "regular"));

    const archived = await listConversations(headers, true);
    archived.forEach((item) => addToIndex(index, item, "archived"));

    const projects = await listProjects(headers);
    for (const project of projects) {
      try {
        const items = await listProjectConversations(headers, project);
        items.forEach((item) => addToIndex(index, item, "project"));
        log(`Project "${project.name}": ${items.length} conversations indexed.`);
      } catch (error) {
        warn(`Project "${project.name}" could not be indexed:`, error.message);
      }
    }

    const list = [...index.values()];
    list.sort((a, b) => {
      const ta = Number(a.create_time || a.update_time || 0);
      const tb = Number(b.create_time || b.update_time || 0);
      return ta - tb;
    });

    return { list, projects };
  }

  function timestamp(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }

  function needsRefresh(saved, meta) {
    if (!saved || saved.conversation_id !== meta.id || saved?._exporter?.version !== VERSION) return true;
    const oldTime = timestamp(saved._index_update_time);
    const newTime = timestamp(meta.update_time);
    return oldTime == null || newTime == null || newTime !== oldTime;
  }

  async function exportJSONL(db, index, manifestExtras, failures) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
        const manifest = {
          record_type: "manifest",
          format: "chatgpt-history-export-jsonl",
          exporter: APP,
          version: VERSION,
          exported_at: new Date().toISOString(),
          indexed_conversations: index.length,
          failures,
          ...manifestExtras,
        };

        controller.enqueue(
          encoder.encode(JSON.stringify(manifest) + "\n")
        );

        for (const meta of index) {
          const saved = await dbGet(db, meta.id);
          if (!saved || failures.some((f) => f.id === meta.id)) continue;

          const record = {
            record_type: "conversation",
            index: meta,
            conversation: saved,
          };

          controller.enqueue(
            encoder.encode(JSON.stringify(record) + "\n")
          );
        }

        controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const blob = await new Response(stream).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    a.href = url;
    a.download = `chatgpt_history_${stamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);

    log(
      `Export created: ${(blob.size / 1024 / 1024).toFixed(2)} MB, ${
        index.length
      } indexed conversations.`
    );
  }

  log(`${APP} v${VERSION} starting...`);
  log("Single-request mode: no parallel conversation downloads.");

  if (location.origin !== "https://chatgpt.com") throw new Error("Run only on https://chatgpt.com.");
  const lock = "__chatgptHistoryExporterRunning";
  if (globalThis[lock]) throw new Error("An exporter is already running in this tab.");
  globalThis[lock] = true;
  let db;
  try {
  db = await openDatabase();
  const token = await getAccessToken();
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  const { list: index, projects } = await buildIndex(headers);
  log(`Unique conversations indexed: ${index.length}`);

  const failures = [];
  let completed = 0;
  let reused = 0;

  for (let i = 0; i < index.length; i++) {
    const meta = index[i];
    const saved = await dbGet(db, meta.id);

    if (!needsRefresh(saved, meta)) {
      reused += 1;
      completed += 1;
      log(`[${i + 1}/${index.length}] Checkpoint reused: ${meta.title}`);
      continue;
    }

    log(`[${i + 1}/${index.length}] Downloading: ${meta.title}`);

    try {
      const conversation = await fetchConversation(headers, meta.id);
      conversation._index_update_time = meta.update_time || null;
      conversation._index_sources = meta.sources;
      conversation._project_name = meta.project_name || null;

      await dbPut(db, conversation);
      completed += 1;

      log(
        `✓ Saved checkpoint: ${meta.title} (${conversation.messages.length} message objects)`
      );
    } catch (error) {
      failures.push({
        id: meta.id,
        title: meta.title,
        error: String(error?.message || error),
      });
      console.error(`[${APP}]`, meta.id, error);
    }
  }

  log(
    `Download pass complete. Completed/reused: ${completed}/${index.length}. Failures: ${failures.length}.`
  );

  await exportJSONL(
    db,
    index,
    {
      projects_detected: projects.length,
      checkpoint_reused: reused,
      completed_or_reused: completed,
      rate_limit_strategy:
        "single-request circuit breaker with Retry-After support, stepped cooldown and jitter",
    },
    failures
  );

  if (failures.length) {
    warn(
      "Some conversations failed. Successful conversations are already checkpointed in IndexedDB. Re-run the same script to resume."
    );
  } else {
    log("DONE. All indexed conversations exported; full account and Projects coverage is not proven.");
  }
  } finally {
    if (db) db.close();
    delete globalThis[lock];
  }
})().catch((error) => console.error("[ChatGPT History Exporter]", error.message));
