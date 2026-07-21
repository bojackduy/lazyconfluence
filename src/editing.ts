import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PageBodyArtifact, IndexRepository, PageDraft } from "./index/repository"
import type { IndexedPage } from "./model"

export type ExternalEditor = (filePath: string) => Promise<void>

export interface EditableDraftInput {
  page: IndexedPage
  body: PageBodyArtifact
  draft: PageDraft | null
}

export type EditPageDraftResult =
  | { status: "saved"; page: IndexedPage; draft: PageDraft }
  | { status: "unchanged"; page: IndexedPage }

export interface EditPageDraftOptions {
  editor?: ExternalEditor
  env?: NodeJS.ProcessEnv
  now?: () => Date
  beforeEditor?: () => void | Promise<void>
  afterEditor?: () => void | Promise<void>
}

export function readEditableDraftInput(repository: IndexRepository, pageId: string): EditableDraftInput {
  const page = repository.getPage(pageId)
  if (!page) throw new Error(`Page not found in local index: ${pageId}`)

  const body = repository.getPageBody(pageId)
  if (!body) throw new Error(`No editable body artifact found for ${page.title} (${page.pageId}). Run \`bun run start sync\` first.`)

  return {
    page,
    body,
    draft: repository.getPageDraft(pageId),
  }
}

export function savePageDraft(repository: IndexRepository, page: IndexedPage, body: PageBodyArtifact, existing: PageDraft | null, draftMarkdown: string, now: () => Date = () => new Date()) {
  const timestamp = now().toISOString()
  const draft: PageDraft = {
    pageId: page.pageId,
    baseRemoteVersion: existing?.baseRemoteVersion ?? body.remoteVersion,
    baseSourceHash: existing?.baseSourceHash ?? body.sourceHash,
    draftMarkdown,
    status: "draft",
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    stagedAt: null,
  }

  repository.upsertPageDraft(draft)

  return { page, draft }
}

export async function editPageDraftInExternalEditor(repository: IndexRepository, pageId: string, options: EditPageDraftOptions = {}): Promise<EditPageDraftResult> {
  const editor = options.editor ?? configuredExternalEditor(options.env)
  const input = readEditableDraftInput(repository, pageId)
  const originalMarkdown = input.draft?.draftMarkdown ?? input.body.editableMarkdown
  const tempDir = await mkdtemp(join(tmpdir(), "lazyconfluence-edit-"))

  try {
    const draftPath = join(tempDir, `${safeFileName(input.page.title || pageId)}.md`)

    await writeFile(draftPath, originalMarkdown, "utf8")
    await runWithEditorHooks(editor, draftPath, options)
    const draftMarkdown = await readFile(draftPath, "utf8")

    if (draftMarkdown === originalMarkdown) return { status: "unchanged", page: input.page }

    const saved = savePageDraft(repository, input.page, input.body, input.draft, draftMarkdown, options.now)
    return { status: "saved", page: saved.page, draft: saved.draft }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export function formatMarkdownDiff(baseMarkdown: string, draftMarkdown: string) {
  if (baseMarkdown === draftMarkdown) return "No draft changes."

  return ["--- synced", "+++ draft", ...lineDiff(normalizeNewlines(baseMarkdown).split("\n"), normalizeNewlines(draftMarkdown).split("\n"))].join("\n")
}

function configuredExternalEditor(env: NodeJS.ProcessEnv = process.env): ExternalEditor {
  const editor = env.VISUAL || env.EDITOR
  if (!editor) throw new Error("No editor configured. Set VISUAL or EDITOR, or use `draft <page-id> --file <markdown-file>`.")

  return (filePath) => runEditorCommand(editor, filePath)
}

async function runWithEditorHooks(editor: ExternalEditor, draftPath: string, options: EditPageDraftOptions) {
  let hooksStarted = false

  try {
    await options.beforeEditor?.()
    hooksStarted = true
    await editor(draftPath)
  } finally {
    if (hooksStarted) await options.afterEditor?.()
  }
}

async function runEditorCommand(editor: string, filePath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [filePath], { shell: true, stdio: "inherit" })

    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Editor exited with code ${code ?? "unknown"}.`))
    })
  })
}

function lineDiff(baseLines: string[], draftLines: string[]) {
  const table = Array.from({ length: baseLines.length + 1 }, () => new Uint32Array(draftLines.length + 1))

  for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let draftIndex = draftLines.length - 1; draftIndex >= 0; draftIndex -= 1) {
      table[baseIndex][draftIndex] = baseLines[baseIndex] === draftLines[draftIndex]
        ? table[baseIndex + 1][draftIndex + 1] + 1
        : Math.max(table[baseIndex + 1][draftIndex], table[baseIndex][draftIndex + 1])
    }
  }

  const lines: string[] = []
  let baseIndex = 0
  let draftIndex = 0

  while (baseIndex < baseLines.length || draftIndex < draftLines.length) {
    if (baseLines[baseIndex] === draftLines[draftIndex]) {
      lines.push(` ${baseLines[baseIndex] ?? ""}`)
      baseIndex += 1
      draftIndex += 1
      continue
    }

    if (draftIndex < draftLines.length && (baseIndex >= baseLines.length || table[baseIndex][draftIndex + 1] >= table[baseIndex + 1][draftIndex])) {
      lines.push(`+${draftLines[draftIndex]}`)
      draftIndex += 1
      continue
    }

    lines.push(`-${baseLines[baseIndex]}`)
    baseIndex += 1
  }

  return lines
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, "\n")
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "page"
}
