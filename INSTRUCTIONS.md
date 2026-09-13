# GPT Stack Dump — Complete Usage Guide

This file contains the full step-by-step instructions for using **GPT Stack Dump 1.0.1**.

These instructions are aligned with the shipped source. Live account export and actual browser checkpoint/download behavior remain **NOT_RUN** for this release; see [VALIDATION.md](VALIDATION.md).

The main [README.md](README.md) explains what the project does. Use is governed by the [source-available LICENSE](LICENSE).
This file explains **exactly how to run it, what to expect, where the data is stored, and what to do if something goes wrong**.

---

# 1. What GPT Stack Dump does

GPT Stack Dump exports the conversation history available to your currently signed-in ChatGPT account.

It is designed to:

- discover conversations automatically;
- download long conversations without manually scrolling them to the top;
- process conversations one at a time;
- pause automatically when ChatGPT returns a server-side rate limit;
- save completed conversations as local checkpoints;
- continue after interruption without starting from zero;
- export the result as a local `.jsonl` file.

The exporter does **not** require Python, Node.js, a browser extension, or a separate desktop application.

It runs directly inside the browser page where you are already signed in to ChatGPT.

---

# 2. Recommended browser

Use a current version of:

- Google Chrome
- Microsoft Edge
- another Chromium-based browser with standard Developer Tools support

Chrome or Edge is recommended because the instructions below match their interface.

---

# 3. Before you start

Before running the exporter:

1. Open:

   `https://chatgpt.com/`

2. Sign in to the ChatGPT account whose conversations you want to export.

3. Keep the ChatGPT tab open during the export.

4. Make sure your computer has enough free disk space for the resulting file.

Large ChatGPT histories can produce very large exports.

---

# 4. Open Developer Tools

While the ChatGPT tab is active, press:

```text
F12
```

If `F12` does not open Developer Tools, use:

```text
Ctrl + Shift + I
```

On some keyboards you may need:

```text
Fn + F12
```

Developer Tools should open on the right side or bottom of the browser window.

---

# 5. Open the Console

At the top of Developer Tools, select:

```text
Console
```

If you do not see `Console`, click the `>>` button and select it from the menu.

You should now see a console prompt where JavaScript can be executed.

---

# 6. If Chrome refuses to let you paste

Chrome may display a warning designed to prevent users from pasting unknown code into Developer Tools.

If Chrome specifically asks you to type:

```text
allow pasting
```

type those words manually and press Enter.

Then paste the exporter.

Do not disable browser security settings and do not paste scripts from sources you do not trust.

---

# 7. Copy the exporter

Open the project file:

```text
exporter.js
```

Copy the complete contents of the file.

Do not copy only part of the script.

---

# 8. Start the export

Return to:

```text
Developer Tools → Console
```

Paste the complete exporter code into the Console.

Press:

```text
Enter
```

The exporter will start.

You should see progress messages similar to:

```text
[ChatGPT History Exporter] Conversations discovered: 106
[1/106] Downloading ...
[2/106] Downloading ...
[3/106] Downloading ...
```

The exact wording may differ slightly between releases.

---

# 9. You do NOT need to open every chat

Do not manually open conversations.

Do not manually scroll old conversations upward.

ChatGPT's normal interface uses lazy loading, so older messages may only appear visually after scrolling.

GPT Stack Dump does not depend on what is currently visible in the browser window.

It requests the conversation data page by page and follows the available pagination cursors automatically.

---

# 10. What happens during the export

The general process is:

```text
discover conversation IDs
        ↓
download one conversation
        ↓
follow older pages if necessary
        ↓
merge the pages
        ↓
save a local checkpoint
        ↓
move to the next conversation
```

Only one conversation request is processed at a time.

The exporter does not intentionally create a large parallel request flood.

---

# 11. What HTTP 200 means

You may see HTTP status codes in Developer Tools.

A successful request normally returns:

```text
200
```

This means the server accepted the request and returned data.

You do not need to do anything when you see successful `200` responses.

---

# 12. What HTTP 429 means

During a large export, ChatGPT may temporarily return:

```text
429 Too Many Requests
```

This is a server-side rate limit.

It does **not** mean that your export is broken.

It means ChatGPT is asking the exporter to slow down.

GPT Stack Dump is designed to react conservatively.

Instead of continuously sending requests, it enters a cooldown period.

The fallback cooldown sequence can grow approximately like:

```text
12 seconds
40 seconds
75 seconds
120 seconds
180 seconds
240 seconds
300 seconds
```

Small random variation may be added to the waiting time.

For HTTP 429, the exporter waits at least the parsed `Retry-After` duration when present, including after jitter. Persistent 429 and selected server errors retry without a fixed attempt limit. Reload or close the tab to stop.

After waiting, GPT Stack Dump retries the useful request it already needed instead of running a separate high-frequency probe.

---

# 13. What to do when you see 429

Usually:

```text
Do nothing.
```

Leave the tab open.

Let the exporter wait and continue automatically.

Do not repeatedly restart the exporter just because you see `429`.

Repeated manual restarts can create more unnecessary requests.

---

# 14. Why later conversations may become slower

Large histories may export very quickly at first and then slow down later.

This is normally caused by server-side rate limiting rather than local processing speed.

Earlier preparation notes report a prototype download pass reaching 106 conversations. Its final packaging step failed with a string-size error. This historical report is not a live validation of version 1.0.1.

According to those notes, the early part completed quickly, while later conversations became slower after repeated `429` responses.

The exact threshold is not fixed.

It may vary depending on:

- server conditions;
- account state;
- number of conversations;
- size of individual conversations;
- current ChatGPT implementation;
- future changes made by OpenAI.

Do not assume that a specific number such as 70 is a universal limit.

---

# 15. What HTTP 500 means

You may occasionally see:

```text
500 Internal Server Error
```

This means the ChatGPT server failed to process that particular request.

The exporter may retry temporary `500`, `502`, `503`, or `504` responses after waiting.

One known area that can change frequently is ChatGPT Projects.

If the Projects endpoint fails, the exporter may skip Projects safely and continue with other conversations.

A Projects failure does not necessarily mean the complete exporter has failed.

---

# 16. Checkpoints

After a conversation has been downloaded successfully, GPT Stack Dump stores a checkpoint locally in the browser.

The checkpoint database uses browser IndexedDB.

This means completed work does not need to exist only in JavaScript memory until the very end.

The checkpoint allows the exporter to resume more safely.

---

# 17. Where checkpoints are stored

Checkpoints are stored in IndexedDB for the ChatGPT origin, in the same browser profile.

Version 1.0.1 uses this exact database name:

```text
chatgpt-history-exporter-v1.0.1
```

The object store is `conversations`. Checkpoints are working data, not the final downloaded file. This release does not reuse or delete older-version databases.

Checkpoints are not encrypted by the script or isolated per account. Other code running on the ChatGPT origin can access them. Use a separate browser profile per account.

---

# 18. If the browser tab is closed accidentally

If the exporter uses the checkpoint-enabled version and completed conversations have already been saved:

1. Open ChatGPT again.
2. Open Developer Tools.
3. Open Console.
4. Run the same exporter again.

The exporter should detect previously saved checkpoints and avoid unnecessarily downloading completed unchanged conversations again.

---

# 19. If the browser crashes

Use the same procedure:

```text
Open ChatGPT
→ F12
→ Console
→ paste exporter.js
→ Enter
```

Checkpointed conversations should remain available unless browser storage was cleared.

---

# 20. If the computer is restarted

Browser IndexedDB normally survives a normal computer restart.

After restarting:

1. open the same browser profile;
2. open ChatGPT;
3. sign in if necessary;
4. run the exporter again.

Do not clear browser site data if you intend to resume from the existing checkpoint.

---

# 21. Do not clear browser storage during an unfinished export

Avoid clearing:

- cookies;
- site data;
- IndexedDB;
- browser storage for `chatgpt.com`

while you are relying on saved checkpoints.

Clearing the relevant site storage can remove checkpoint data.

---

# 22. Where the final file is saved

When the export finishes, the browser triggers a normal file download.

The final file is usually saved to your browser's configured Downloads location.

For many Windows installations this is:

```text
C:\Users\<your Windows user>\Downloads
```

However, the exact location depends on your browser settings.

If your browser is configured to ask where each file should be saved, a normal Save dialog will appear.

---

# 23. Final file format

The current exporter uses:

```text
.jsonl
```

JSONL means:

```text
JSON Lines
```

Each line is an independent JSON record.

This is intentional.

A previous prototype demonstrated that trying to convert an extremely large entire history into one single JavaScript string using:

```javascript
JSON.stringify(entireHistory)
```

can hit JavaScript/V8 string-size limits.

JSONL avoids requiring the entire history to become one giant string at once.

---

# 24. Example file name

Version 1.0.1 names the download using the export timestamp:

```text
chatgpt_history_YYYY-MM-DDTHH-MM-SS-sssZ.jsonl
```

---

# 25. What is inside the JSONL file

The first line is a manifest. Each later line contains one exported conversation. These are synthetic, abbreviated examples with the current field names:

```json
{"record_type":"manifest","format":"chatgpt-history-export-jsonl","version":"1.0.1","indexed_conversations":1,"failures":[],"completed_or_reused":1,"checkpoint_reused":0,"projects_detected":0}
{"record_type":"conversation","index":{"id":"example"},"conversation":{"conversation_id":"example","messages":[]}}
```

The real manifest also includes exporter name, export time, and rate-limit strategy. The conversation record includes index metadata and the merged conversation, with exporter metadata added.

The raw data can contain titles, timestamps, messages, model metadata, and file references. Its structure depends on undocumented web endpoints. Binary attachments are not downloaded separately.

---

# 26. JSONL is not plain text chat

The export preserves structured data.

It is not intended to look like:

```text
User: Hello
Assistant: Hi
```

by default.

JSONL is better for:

- backups;
- analysis;
- conversion;
- searching;
- later transformation into Markdown;
- importing into custom tools;
- integrity checking.

A separate converter can later turn the JSONL archive into a human-readable format.

---

# 27. If no download appears at the end

First check the Console.

Look for a final status message indicating whether the export completed.

Also check:

```text
Chrome / Edge → Downloads
```

You can usually open Downloads with:

```text
Ctrl + J
```

If the browser blocked the download, look for a download warning or permission indicator in the browser UI.

Do not immediately erase the checkpoint database.

If completed conversations are checkpointed, the data may still be available locally for another export attempt.

---

# 28. If the export stops before the end

Check the last Console messages.

Possible causes include:

- temporary server rate limiting;
- expired ChatGPT login session;
- network interruption;
- browser tab closure;
- server-side endpoint changes;
- Projects endpoint failure;
- browser memory pressure;
- unexpected internal API response.

If checkpoints were enabled, rerun the exporter before assuming the completed work is lost.

---

# 29. If the ChatGPT login session expires

If the Console shows authorization/session errors:

1. refresh or reopen ChatGPT;
2. sign in again;
3. verify that ChatGPT works normally;
4. rerun the exporter.

Do not manually copy your ChatGPT cookies or access token into third-party websites.

GPT Stack Dump is designed to use the authenticated session already available to the ChatGPT page.

---

# 30. If the exporter is interrupted during one conversation

A checkpoint should only be considered complete after that conversation has been fully downloaded and merged.

If interruption occurs in the middle of a conversation, that conversation may need to be fetched again.

Already completed conversations should remain checkpointed.

---

# 31. If you run the exporter twice

Version 1.0.1 reuses a checkpoint only when its conversation ID and exporter version match and both recognized update timestamps are equal. Different or unknown timestamps trigger a fresh fetch.

If a refresh fails, the older checkpoint stays in the database but is excluded from that run's export. The failure is listed in the manifest.

Do not run simultaneous exports across tabs in the same profile. The duplicate-run guard protects only the current tab.

---

# 32. If new conversations were created after the previous export

Run GPT Stack Dump again in the same browser profile and account.

It rebuilds the index, downloads newly discovered conversations, and reuses checkpoints only under the rules in section 31. New or changed conversations are fetched and a new JSONL download is created.

Indexing is not an atomic snapshot. Avoid editing conversations while exporting.

---

# 33. If you continued writing in a chat while it was being exported

The exporter captures a conversation according to the state returned by the server when that conversation is fetched.

If you continue writing after that conversation has already been downloaded, the newly added messages may not be present in that particular completed export.

Run the exporter again to refresh conversations that changed after the earlier checkpoint/export.

---

# 34. How to remove checkpoints and start completely fresh

Only do this after verifying your downloaded archive, or when you deliberately want to discard saved work.

1. Stop the exporter by reloading its tab. Stop any other exporter tabs in the same profile.
2. In the ChatGPT Console, run:

```javascript
const checkpointDeletion = indexedDB.deleteDatabase("chatgpt-history-exporter-v1.0.1");
checkpointDeletion.onsuccess = () => console.log("Checkpoint database deleted.");
checkpointDeletion.onerror = () => console.error("Checkpoint deletion failed:", checkpointDeletion.error);
checkpointDeletion.onblocked = () => console.warn("Close other ChatGPT tabs holding this database open.");
```

3. Wait for the success message. A returned request object alone does not prove deletion.
4. Reload ChatGPT before starting a fresh export.

This deletes only the named version 1.0.1 checkpoint database. Older-version databases and downloaded files are separate. Do not delete storage during a running export.

---

# 35. Privacy

GPT Stack Dump is intended to work with your own authenticated ChatGPT account.

The public exporter should not require you to send:

- your password;
- your cookies;
- your access token;
- your exported history

to the project author.

The script should use the session already available inside the ChatGPT page.

The final export remains on the computer where your browser downloads it.

---

# 36. Important privacy warning

Your exported conversation history may contain sensitive information.

Treat the resulting `.jsonl` file as private data.

Do not publish it to GitHub.

Do not upload it to public file-sharing services unless that is your deliberate intention.

Do not commit:

```text
*.jsonl
*.har
conversation exports
browser session data
cookies
access tokens
```

to the GPT Stack Dump repository.

---

# 37. Shared computers

If you use GPT Stack Dump on a shared or public computer:

1. save the final export somewhere secure;
2. remove local checkpoint data after confirming the export;
3. sign out of ChatGPT;
4. clear relevant browser data if appropriate.

For sensitive histories, using a shared computer is not recommended.

---

# 38. Temporary Chats and deleted conversations

GPT Stack Dump can only export information that the current authenticated ChatGPT session can retrieve.

It cannot recreate data that is no longer available to the account.

Examples may include:

- deleted conversations;
- expired temporary conversations;
- data already removed by the service.

The exporter is not a recovery tool for permanently deleted server-side data.

---

# 39. Archived conversations

The exporter attempts to discover archived conversations separately from normal conversation history.

Support depends on the current ChatGPT internal API.

If archived conversations are important, review the final conversation count and verify the result.

---

# 40. Projects

Projects support is experimental.

ChatGPT has changed Projects-related internal endpoints over time.

A Projects request may return:

```text
500 Internal Server Error
```

or another response that differs from the current exporter expectations.

A failed Projects discovery request warns and continues with the projects discovered so far. A per-project indexing failure also warns and continues; those requests retry selected server errors without a fixed limit. Unexpected response shapes or repeated discovery cursors can stop indexing.

Projects warnings are not comprehensively recorded in the manifest. A completed download does not prove Projects coverage.

Always check the Console summary.

---

# 41. Attachments and files

Conversation metadata may contain references to uploaded files or generated artifacts.

Do not assume that exporting conversation JSON automatically downloads every binary attachment.

Attachment downloading is a separate feature and can depend on additional endpoints and access rules.

Version 1.0.1 does not separately download binary attachments of any type. References in conversation JSON are not copies of the referenced files.

---

# 42. Browser memory

Very large histories can use substantial browser memory.

GPT Stack Dump reduces risk by:

- processing conversations incrementally;
- checkpointing completed work;
- serializing output per conversation instead of stringifying the whole history at once.

The script assembles the final Blob in browser memory. It is not constant-memory streaming to disk, and a single huge conversation can still exceed string limits. Allow substantial memory and disk space.

---

# 43. Why one huge JSON string is avoided

This approach is intentionally avoided:

```javascript
const giantString = JSON.stringify(allConversationsAtOnce);
```

For very large histories, JavaScript engines can reject extremely large strings with an error similar to:

```text
RangeError: Invalid string length
```

GPT Stack Dump therefore uses a structure designed for large exports.

---

# 44. What not to do during a long export

Avoid:

- pressing `F5`;
- closing the ChatGPT tab;
- closing the browser;
- clearing ChatGPT site data;
- repeatedly restarting after every `429`;
- manually editing the exporter while it is running;
- running multiple copies of the exporter in parallel on the same account.

Normal browsing in another tab is generally less relevant than the actions above, but a long export is safest when the ChatGPT exporter tab is left alone.

---

# 45. Can you continue using ChatGPT while the exporter runs?

Technically, normal ChatGPT activity does not necessarily terminate the exporter.

However, additional activity may:

- create new conversations;
- modify a conversation after it has already been exported;
- add additional requests to the same service;
- complicate the exact "snapshot" moment.

For the cleanest full-history snapshot, let the exporter finish before making major changes to your conversation history.

---

# 46. If rate limiting becomes very aggressive

Do not fight the server.

GPT Stack Dump is designed to wait.

If the server repeatedly returns `429`, the exporter should increase its cooldown.

If necessary, you can stop active work and rerun later.

With checkpoints enabled, completed conversations should not need to be downloaded again.

---

# 47. Why GPT Stack Dump does not continuously probe the server

There is no reason to repeatedly send separate "are you ready yet?" requests.

After a `429`, the exporter waits.

The next useful conversation request becomes the availability check.

If it succeeds:

```text
200 → useful data received → continue
```

If it fails:

```text
429 → wait longer
```

This reduces unnecessary traffic.

---

# 48. Troubleshooting quick reference

## Problem: Nothing happens after pressing Enter

Check:

- Did you paste the complete script?
- Is the Console showing a syntax error?
- Are you signed in to ChatGPT?
- Did Chrome block pasting?
- Is the page still on `chatgpt.com`?

---

## Problem: Repeated 429 messages

Meaning:

```text
Server-side rate limit
```

Action:

```text
Wait.
```

Do not repeatedly restart the script.

---

## Problem: 500 error

Meaning:

```text
ChatGPT server/internal endpoint error
```

Action:

- allow automatic retry;
- check whether only Projects failed;
- do not assume all downloaded conversations were lost.

---

## Problem: Browser was closed

Action:

- reopen the same browser profile;
- open ChatGPT;
- run the exporter again;
- let it inspect checkpoints.

---

## Problem: Export reached the end but no file is visible

Action:

1. press `Ctrl + J`;
2. inspect browser Downloads;
3. inspect Console final messages;
4. check browser download permissions;
5. do not erase checkpoints until the result is verified.

---

## Problem: File is very large

That can be normal.

Conversation histories can contain substantial metadata in addition to visible text.

Use tools that can process JSONL incrementally instead of trying to open a multi-hundred-megabyte file in a simple text editor.

---

## Problem: JSONL does not open like a normal document

JSONL is structured machine-readable data.

Use:

- a JSONL-aware editor;
- Python;
- jq-compatible tools;
- a dedicated viewer;
- a future GPT Stack Dump converter/viewer.

---

## Problem: Some recent messages are missing

Possible reason:

The conversation changed after it had already been fetched.

Action:

Run the exporter again so changed conversations can be refreshed.

---

# 49. Verifying the result

For an important archive, do not rely only on the existence of the output file.

Useful checks include:

- expected number of conversations;
- unique conversation IDs;
- duplicate IDs;
- missing conversations;
- empty/truncated conversations;
- latest update timestamps;
- archived conversation coverage;
- Projects coverage.

Inspect the manifest fields `indexed_conversations`, `completed_or_reused`, and `failures`, and count the conversation records. An empty failure list does not prove full account, Projects, alternate-branch, or attachment coverage. Missing checkpoints can also reduce output; compare the actual records with the expected archive.

If the console reports missing pagination evidence, a repeated cursor, conflicting messages, a conversation identity mismatch, or an unrecognized list shape, the current response did not meet the exporter's checks. Preserve checkpoints and report a sanitized error; do not remove the checks to force completion.

---

# 50. Security model

GPT Stack Dump does not bypass ChatGPT authorization.

It operates using the account session that is already authenticated in your browser.

It should not be used to:

- access someone else's account;
- bypass authentication;
- evade account permissions;
- deliberately overload the service;
- obtain data the authenticated account is not authorized to retrieve.

---

# 51. Internal API warning

GPT Stack Dump depends on undocumented ChatGPT web endpoints.

These endpoints can change without notice.

A future ChatGPT update can therefore:

- change endpoint URLs;
- change pagination;
- change response fields;
- change authentication behavior;
- change Projects behavior;
- temporarily break the exporter.

This is an expected risk of an unofficial browser-side exporter.

Check the repository for updates if the script stops working after a ChatGPT interface update.

---

# 52. Recommended workflow

For a large export, use this sequence:

```text
1. Open ChatGPT
2. Sign in
3. Press F12
4. Open Console
5. Paste exporter.js
6. Press Enter
7. Leave the exporter running
8. Let automatic cooldowns handle 429
9. Wait for completion
10. Confirm the downloaded .jsonl
11. Verify conversation count
12. Store the file somewhere private
```

---

# 53. Important final rule

During a large export:

```text
Do not panic when it slows down.
```

Fast progress followed by slower progress can simply mean that ChatGPT has begun applying server-side rate limits.

A reliable exporter is not the one that sends the most requests.

A reliable exporter is the one that:

```text
preserves completed work
respects server limits
waits when necessary
continues safely
and produces a local result whose coverage you verify
```

---

# 54. Support information to include when reporting a problem

If you open a GitHub Issue, include:

- browser name and version;
- operating system;
- GPT Stack Dump version;
- approximate conversation count;
- the last few Console status lines, after removing conversation titles, IDs, project names, and other private details;
- HTTP status code if relevant (`429`, `500`, etc.);
- whether the problem affects normal chats, archived chats, Projects, or output creation.

Do **not** post:

- cookies;
- passwords;
- access tokens;
- private conversation text;
- your exported history;
- sensitive screenshots.

---

# 55. Summary

The shortest version is:

```text
Open ChatGPT
→ F12
→ Console
→ paste exporter.js
→ Enter
→ wait
→ browser downloads the .jsonl file
```

If the process is interrupted:

```text
run it again
→ checkpoints allow completed work to be reused
```

If ChatGPT returns:

```text
429
```

the correct action is:

```text
wait
```

GPT Stack Dump is designed to handle that automatically.
