# 04 Confluence API Mapping

## Mission

Build read-only Confluence API access and mapping into local domain records.

## Must Read

- `docs/README.md`
- `docs/BUILD_PLAN.md`
- `AGENTS.md`
- Read `lazylens/` only as reference, never edit it.

## Owns

- `src/confluence/client.ts`
- `src/confluence/mapper.ts`
- `src/confluence/html.ts` only if 02 has not created HTML fixtures and 05 is not owning conversion separately
- `test/confluence-client.test.ts`
- `test/confluence-mapper.test.ts`

## Depends On

- 01 Foundation Shell
- 02 Domain And Demo Data

## Scope

- Normalize Confluence base URL to the wiki root.
- Build basic auth headers from email and token.
- Resolve configured spaces.
- Fetch pages by space with pagination.
- Fetch page body by page ID.
- Fetch direct children by page ID.
- Map page and folder payloads into shared local models.
- Preserve metadata needed for tree navigation and display.
- Keep all tests mocked.

## Acceptance Criteria

- Tests require no real Atlassian credentials.
- Pagination and direct-children behavior are covered.
- API records map consistently into shared app models.
- No files under `lazylens/` are changed.

## Checklist

- [ ] Base URL normalization exists.
- [ ] Auth header construction exists.
- [ ] Space resolution exists.
- [ ] Page list fetch exists.
- [ ] Page body fetch exists.
- [ ] Direct children fetch exists.
- [ ] Mapper exists.
- [ ] Mocked tests pass.
- [ ] `docs/TASK_TRACKER.md` is updated.

## Subagent Prompt

```text
Implement docs/subagents/04-confluence-api-mapping.md. Build the read-only Confluence client and mapper with mocked tests. Use lazylens only as reference. Do not edit lazylens/ and do not build sync orchestration yet.
```
