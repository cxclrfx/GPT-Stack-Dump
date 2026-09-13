# GPT Stack Dump

ChatGPT History Exporter — version 1.0.1

### One-paste, resumable, rate-aware export for large ChatGPT histories

A single-file browser-console exporter for downloading your own ChatGPT conversation history from an already authenticated ChatGPT session.

It is designed for large histories where manual opening, scrolling, copying, and retrying is impractical.

The exporter automatically indexes conversations, walks paginated message history, checkpoints progress locally, reacts politely to server-side rate limits, and writes the result as a single streaming-friendly JSONL file.

> **Unofficial project.** This tool is not affiliated with or endorsed by OpenAI. It relies on undocumented ChatGPT web endpoints that may change at any time. Use it only with your own account and only where permitted.

**Documentation:** [Complete usage and troubleshooting guide](INSTRUCTIONS.md) · [License](LICENSE) · [Validation](VALIDATION.md)

---

## Why this exists

The ChatGPT interface lazily loads conversation content. Very long histories can therefore be inconvenient to back up manually.

This exporter is built around a different workflow:

```text
index conversations
        ↓
download one conversation at a time
        ↓
follow every previous-page cursor
        ↓
save a local checkpoint immediately
        ↓
continue
        ↓
write one JSONL export
```

No conversation needs to be manually opened or scrolled to the top.

---

## Highlights

- **One paste, one run** — no Python, Node.js, browser extension, or external application required.
- **Uses the current ChatGPT login session** — no manual cookie or token copying.
- **Regular conversations** are indexed automatically.
- **Archived conversations** are indexed automatically.
- **Projects are attempted experimentally** and skipped safely if the current ChatGPT build does not expose the expected Projects endpoint.
- **Automatic pagination** — long conversations are fetched page by page.
- **No manual scrolling** — the browser UI does not need to preload the full chat.
- **Checkpoint after every completed conversation** using IndexedDB.
- **Resume support** — rerunning the same script reuses completed checkpoints.
- **Changed chats are refreshed** when their recognized indexed `update_time` differs from the saved checkpoint; unknown timestamps also trigger a fresh fetch.
- **Single-request mode** — conversations are never downloaded in parallel.
- **Rate-aware circuit breaker** — HTTP `429` causes a real cooldown rather than continuous hammering.
- **`Retry-After` support** — when the server supplies a reset time, the exporter respects it.
- **Adaptive recovery** — after a rate limit, the exporter remains slower for a while and gradually accelerates again.
- **Jittered waits** — cooldowns vary slightly to avoid synchronized retry waves.
- **Streaming-friendly JSONL output** — avoids building one enormous `JSON.stringify(...)` string in memory.
- **No third-party upload** — the script itself contains no requests to external services.
- **Message objects are retained** while pages are merged and identical IDs deduplicated; first-page metadata is retained, pagination metadata is removed, and exporter metadata is added.

---

## Earlier prototype report

Preparation notes report an earlier prototype run against **106 conversations**. These observations describe that earlier run, not a live validation of version 1.0.1.

Observed behavior:

- roughly the first **70 conversations** were retrieved within minutes;
- after that, ChatGPT began returning server-side `429 Too Many Requests`;
- the final portion became progressively slower because of the server rate limiter;
- the original prototype reached **106/106 conversations**;
- its final packaging step then exposed a JavaScript/V8 limitation: one enormous `JSON.stringify(...)` could exceed the maximum string size.

That test led directly to the current architecture:

```text
checkpoint continuously
+
never serialize the entire history as one JavaScript string
+
treat 429 as a circuit-breaker event
+
resume instead of restarting
```

The number `70` is **not a hard limit**. Rate-limit thresholds can vary by account, server state, conversation size, and future ChatGPT changes.

---

## Rate-limit behavior

The exporter does **not** create a separate probe that repeatedly asks whether the service is available.

Instead, the next useful request acts as the probe.

```text
NORMAL MODE
    │
    ├── 200 → save checkpoint → continue
    │
    └── 429
          ↓
     CIRCUIT OPEN
     send nothing
          ↓
     wait
          ↓
     retry the same useful request once
          │
          ├── 429 → longer cooldown
          │
          └── 200 → RECOVERY MODE
                       ↓
                  slower requests
                       ↓
                  stable successes
                       ↓
                  gradually return
                  to normal speed
```

Fallback cooldown sequence:

```text
12s → 40s → 75s → 120s → 180s → 240s → 300s
```

If ChatGPT returns a `Retry-After` header, the exporter waits at least that long.

Only **one request is active at a time**.

---

## Output format

The download is a single file:

```text
chatgpt_history_YYYY-MM-DDTHH-MM-SS-sssZ.jsonl
```

JSONL means **one JSON record per line**.

The first line is a manifest:

```json
{"record_type":"manifest","format":"chatgpt-history-export-jsonl","version":"1.0.1"}
```

Every later line represents one conversation:

```json
{"record_type":"conversation","index":{"id":"example"},"conversation":{"conversation_id":"example","messages":[]}}
```

This format is deliberately used instead of one gigantic JSON array.

Advantages:

- one conversation can be serialized independently;
- very large histories do not require one giant JavaScript string;
- corrupted or incomplete trailing data does not destroy earlier lines;
- processing tools can read the file incrementally.

---

## Resume and checkpoints

Each successfully downloaded conversation is immediately stored in browser IndexedDB under:

```text
chatgpt-history-exporter-v1.0.1
```

If the tab is closed, the browser crashes, the network becomes unavailable, or the server begins rate-limiting aggressively, run the same exporter again.

Completed checkpoints from this version are reused only when their conversation ID and recognized update timestamp match the current index. Unknown or changed timestamps trigger a fresh fetch. Version 1.0.1 uses a new database so older potentially incomplete checkpoints are not trusted; the old database is not deleted.

To deliberately remove the local checkpoint database, first stop the exporter by reloading its tab and stop any other exporter tabs. Then run this in the ChatGPT console:

```javascript
indexedDB.deleteDatabase("chatgpt-history-exporter-v1.0.1");
```

Wait for deletion to succeed, then reload the page before starting a completely fresh export. See [checkpoint cleanup instructions](INSTRUCTIONS.md#34-how-to-remove-checkpoints-and-start-completely-fresh) for success, error, and blocked-deletion handling.

---

## Privacy model

The script:

- runs inside the ChatGPT page in your browser;
- uses the already authenticated ChatGPT session;
- sends conversation requests only to the same ChatGPT service;
- does not ask you to paste cookies;
- does not ask you to paste an access token;
- does not contain analytics;
- does not contain telemetry;
- does not contain third-party upload endpoints;
- saves checkpoints in the browser's local IndexedDB;
- downloads the final export to your own computer.

The session token is used transiently by the running page and is **not intentionally written into the exported JSONL file**.

Checkpoints contain private conversation data and remain accessible to code running on the ChatGPT origin. They are not encrypted by this script or isolated per account. Use a separate browser profile per account. Stop the exporter before removing its checkpoint on a shared computer.

---

## Important limitations

This is an unofficial exporter that depends on internal web endpoints.

It cannot guarantee access to data that the current authenticated ChatGPT session itself cannot retrieve.

In particular:

- deleted conversations cannot be recreated from nothing;
- expired temporary chats may be unavailable;
- internal API paths or response shapes may change;
- Projects support is experimental because that endpoint has changed across ChatGPT builds;
- server-side rate limits are controlled by ChatGPT, not by this script;
- very large exports still require enough browser and disk capacity to create the final Blob/file;
- the tool does not bypass authorization, account restrictions, or server-side access controls;
- list indexing is not an atomic account snapshot; avoid editing chats during export;
- unavailable Projects endpoints or failed project indexing can leave coverage incomplete; warnings appear in the console, but the manifest does not enumerate every Projects indexing failure;
- a successful download proves neither complete account coverage nor preservation of every alternate branch or attachment; attachment binaries are not downloaded separately;
- unknown list shapes, missing pagination evidence, conflicting duplicate messages, and mismatched conversation IDs fail closed;
- a failed refresh is listed in the manifest and its older checkpoint is excluded from that export;
- retries for persistent 429 and selected server errors are unbounded; reload or close the tab to stop;
- a single exceptionally large conversation can still exceed serialization limits; this is per-conversation serialization, not constant-memory disk streaming.

For an official account archive, use OpenAI's official data-export mechanism.

---

## How to run

See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the complete guide, checkpoint cleanup, and troubleshooting.

1. Open `https://chatgpt.com/` in Chrome or Edge.
2. Sign in to the account whose history you want to export.
3. Open **Developer Tools**.
4. Open **Console**.
5. Open [exporter.js](exporter.js) and read the source before running it.
6. Select **Raw** to view the plain JavaScript file.
7. Copy the complete file.
8. Paste it into the Console and press **Enter**.
9. Keep the ChatGPT tab open while it runs.
10. Watch the progress messages in the Console. Run only one export across all tabs in the browser profile; the duplicate-run guard covers the current tab only.
11. When complete, the browser downloads the `.jsonl` file automatically.

Do not paste scripts into DevTools unless you have reviewed and trust them.

---

## Exporter source

The complete source is in [exporter.js](exporter.js). Open the file, select **Raw**, and copy its contents. There is no encoded payload or third-party loader.

---

## Design principles

### 1. Preserve completed work

A completed conversation is checkpointed immediately.

The exporter never depends on reaching the final line before earlier work becomes durable.

### 2. Do not confuse rate limiting with failure

`429 Too Many Requests` means:

```text
wait
```

not:

```text
start over
```

### 3. Do not hammer the service

After a rate limit, the exporter stops making requests entirely for a cooldown period.

There is no parallel request flood and no high-frequency availability probe.

### 4. The next useful request is the probe

After cooldown, the exporter retries the request that was already needed.

A successful `200` both confirms availability and produces useful data.

### 5. Large history should not mean giant string

The final export is assembled as a stream of individual JSONL records instead of:

```javascript
JSON.stringify(entire_history_of_every_chat_at_once)
```

### 6. Resume should be normal behavior

Interruptions are expected in large exports.

Rerunning the exporter should continue work rather than punish the user by restarting from conversation one.

---

## What makes this implementation different

Many history-export scripts focus on the happy path:

```text
get conversation list
→ fetch everything
→ stringify everything
→ download
```

This project is aimed specifically at **large, real-world histories**, where the harder problems are:

```text
pagination
rate limiting
partial progress
long-running sessions
browser memory limits
safe resumption
server-side variability
```

The emphasis is therefore not only on downloading conversations, but on **finishing reliably without unnecessary repeated work**.

---

## Status

**Version 1.0.1: local synthetic checks; live account export NOT_RUN.**

See [VALIDATION.md](VALIDATION.md) for the checked boundary and known limitations.

Current implementation includes the improvements discovered during that live test:

- adaptive rate limiting;
- circuit-breaker cooldowns;
- local checkpointing;
- resume behavior;
- per-conversation serialization;
- JSONL output;
- regular and archived chat indexing;
- experimental Projects discovery.

Because ChatGPT's internal endpoints are undocumented, compatibility should always be considered best-effort.

---

## Responsible use

Use this project for exporting data from accounts you are authorized to access.

Do not use it to:

- access another person's account;
- bypass authentication;
- defeat server-side permissions;
- deliberately generate excessive traffic;
- ignore explicit service restrictions.

The rate-control logic is intentionally conservative after a server `429`.

---

## Repository layout

```text
README.md
INSTRUCTIONS.md
LICENSE
exporter.js
VALIDATION.md
tests/exporter.test.cjs
.gitignore
```

---

## License

Copyright © 2026 cxclrfx.

GPT Stack Dump is distributed under the [GPT Stack Dump Source-Available License, version 1.0](LICENSE).

Personal non-commercial use, non-commercial education, and non-commercial evaluation/testing are permitted. Copies and modifications may be shared without charge for those purposes under the license's notice and confidentiality conditions.

**A separate written commercial license is required before commercial deployment (including internal business use), resale, paid integration, managed-service use, or embedding in another product or service.** Managed-service use and embedding require that license even when end users are not charged.

This is source-available software with use restrictions. It is **not open source**. The license covers the software and documentation; it does not claim ownership of your conversations or exports. Contact [cxclrfx](https://github.com/cxclrfx) using the contact information made available on that profile for commercial licensing. The [LICENSE](LICENSE) contains the controlling terms.

---

## Disclaimer

This project is provided as-is, without warranty.

ChatGPT, OpenAI, and related names are trademarks of their respective owners. This project is independent and unofficial.
