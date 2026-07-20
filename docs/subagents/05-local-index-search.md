# 05 Local Index And Search

## Mission

Create local storage, search, hierarchy, and relationship queries.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `AGENTS.md`

## Owns

- `src/index/db.ts`
- `src/index/schema.ts`
- `src/index/repository.ts`
- `src/index/search.ts`
- `test/index.test.ts`

## Depends On

- 01 Foundation Shell
- 02 Domain And Demo Data

## Scope

- Open and create the local database.
- Create schema for spaces, pages, links, and search content.
- Implement deterministic migrations.
- Implement upsert space/page/link operations.
- Implement children queries.
- Implement outgoing links and incoming links.
- Implement page lookup by ID.
- Implement active-space search.
- Implement all-space search.
- Implement URL-to-page relationship matching.

## Acceptance Criteria

- Repository tests pass without network access.
- Search returns page results with title, path, snippet, and space.
- Relationship queries identify indexed internal links.
- No files under `lazylens/` are changed.

## Checklist

- [ ] Database open/create exists.
- [ ] Schema exists.
- [ ] Migrations exist.
- [ ] Upsert operations exist.
- [ ] Children query exists.
- [ ] Outgoing link query exists.
- [ ] Incoming link query exists.
- [ ] Search exists.
- [ ] URL matching exists.
- [ ] Tests pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/05-local-index-search.md. Build the local database and repository layer against shared models and fixtures. Do not call Confluence and do not implement UI.
```
