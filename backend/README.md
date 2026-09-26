# Google Sheets backend

Spreadsheet: `1neTmFrGhmIqkiv8g1EBdvpQmENe8-RDDB8ei6NtwpMs`.
Bound Apps Script project: `1aO-7s4O4-sFDEUvnNKxYCRQNWvr0qgxEzU4tb0JckE7llW1CTYjAeOU5`.
The deployed script is a compact equivalent of Code.gs. Web-app URL is in dist/config.json.

## Data
- Пользователи: one row per case-insensitive normalized nickname. Login by nickname is intentional; anyone knowing a nickname can use that profile. The owner explicitly accepted this model.
- Задания: stable task and leaf variant IDs, parent relationship, course/chapter/title. IDs must not be renumbered when extending the course.
- Прогресс: one row per user/course/leaf variant. Missing row means not attempted. No duplicate parent attempts: parent completion is derived from all its leaves.
- solved contains «решена» or «не решена» and represents the latest submission, not lifetime success. New submission resets it until all tests pass.
- last_code is preserved exactly, with an invisible prefix in Sheets to prevent formula interpretation. Responses strip this prefix.
- last_status: checking, passed, failed, error, cancelled. interrupted browser sessions may remain checking; code is already durable.
- attempt_id and revision prevent late results from overwriting a newer attempt.

## Protocol
POST JSON with Content-Type text/plain;charset=utf-8; follow Google ContentService redirects. Actions: register, login, resume, logout, begin, finish. Session token is stored hashed in Script Properties, expires after 30 days. Spreadsheet writes use a script lock.

Python runs in the browser. Test results are submitted by the browser; this is a friends' trainer, not a tamper-proof assessment platform. Last submitted code is saved before execution; result writes retry from a local outbox if the network fails. Unsent editor drafts are not cloud saves.

## Updating
Edit Code.gs in the bound project; save; Manage deployments → Edit → New version → Deploy. Keep execute-as-owner and approved Anyone access. Preserve the existing deployment URL. Rebuild standalone HTML after changing frontend config or assets.

Theory: public Drive PDF «Основы Python», id 1qv5U9AH1pxlq11hQvawIj5xLgPpbzcdC. If replacing it with a new file rather than a new revision, update the download link and config.
