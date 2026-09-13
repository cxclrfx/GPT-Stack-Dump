# Validation — version 1.0.1

## Scope and result

Local synthetic regression suite: **PASS, 13 tests**.
JavaScript syntax check: **PASS**.
Live ChatGPT account export, actual browser IndexedDB durability, browser download behavior, and undocumented endpoint compatibility: **NOT_RUN**.

Run from the repository root with a Node.js runtime supporting the built-in test runner:

```text
node --check exporter.js
node --test tests/exporter.test.cjs
```

The tests extract the function definitions from the shipped source into an isolated context with synthetic fetch, database, timer, and download adapters. They do not authenticate, read an account, or make network requests. These are project regression tests, not independent closure or a completeness proof.

## Changes since version 1.0.0

- Preserve the server's Retry-After minimum even when jitter decreases the fallback delay.
- Reject missing or repeated previous-page cursors when more history is indicated; require an explicit boolean completion flag.
- Reject conflicting message versions across overlapping pages and mismatched conversation IDs.
- Reject unrecognized list responses, contradictory empty pages, and repeated list IDs/cursors.
- Compare recognized numeric or ISO update timestamps; refetch unknown, changed, or incompatible checkpoints.
- Use a new checkpoint database; preserve the old database without trusting it.
- Exclude old checkpoints from the output when their refresh failed.
- Propagate output stream errors instead of leaving export pending.
- Avoid copying HTTP response bodies into failure records.
- Require the ChatGPT origin and prevent duplicate runs in the same tab; close the database and release the guard on exit.

## Limits

These checks do not establish full account, Projects, alternate-branch, or attachment coverage. Projects indexing warnings are not comprehensively recorded in the manifest. Indexing is not an atomic snapshot. Checkpoints are origin-local rather than account-encrypted or account-isolated. Use a separate browser profile per account and run only one export across all tabs.

The export still assembles a final Blob in browser memory and serializes one conversation at a time; very large individual conversations may fail. Persistent rate and server errors retry until the tab is stopped. See README.md for operation and privacy details.

The earlier 106-conversation run is a historical report about a prototype; it is not validation of this release.
