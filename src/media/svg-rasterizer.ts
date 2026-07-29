import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core"

const maxSvgInputBytes = 2 * 1024 * 1024
const maxSvgSourceDimension = 4096
const maxSvgSourcePixels = 16 * 1024 * 1024
const maxSvgRasterDimension = 1024
const maxSvgRasterPixels = 1024 * 1024
const rasterTimeoutMs = 10_000

export interface SvgRasterizer {
  rasterize(source: Uint8Array): Promise<Uint8Array>
  close(): Promise<void>
}

export async function createSvgRasterizer(env: NodeJS.ProcessEnv = process.env): Promise<SvgRasterizer | null> {
  const executablePath = chromiumExecutablePath(env)
  if (!executablePath) return null

  const browser = await chromium.launch({ headless: true, executablePath })
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: maxSvgRasterDimension, height: maxSvgRasterDimension } })
  await context.route("**/*", (route) => route.abort())
  const page = await context.newPage()

  return { rasterize: (source) => rasterizeSvg(page, source), close: () => closeBrowser(browser, context) }
}

export function chromiumExecutablePath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.LAZYCONFLUENCE_CHROMIUM_PATH
  if (configured && existsSync(configured)) return configured

  for (const candidate of chromiumCandidates()) {
    if (existsSync(candidate)) return candidate
  }

  return null
}

export function rasterizeSvgWithResvg(source: Uint8Array) {
  const svg = svgSource(source)

  try {
    const probe = new Resvg(svg, svgRenderOptions())
    validateSvgDimensions(probe.width, probe.height)
    const scale = Math.min(1, maxSvgRasterDimension / Math.max(probe.width, probe.height), Math.sqrt(maxSvgRasterPixels / (probe.width * probe.height)))
    const rendered = new Resvg(svg, svgRenderOptions(Math.max(1, Math.floor(probe.width * scale)))).render()

    return new Uint8Array(rendered.asPng())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid SVG: ${message}`)
  }
}

async function rasterizeSvg(page: Page, source: Uint8Array) {
  const svg = svgSource(source)
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  await page.setContent(`<style>html,body{margin:0;padding:0;background:transparent}#svg{display:block}</style><img id="svg" src="${dataUrl}">`, { waitUntil: "load", timeout: rasterTimeoutMs })
  await page.waitForFunction(() => {
    const image = document.querySelector("#svg") as HTMLImageElement | null
    return Boolean(image?.complete && image.naturalWidth && image.naturalHeight)
  }, undefined, { timeout: rasterTimeoutMs })

  const dimensions = await page.locator("#svg").evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  validateSvgDimensions(dimensions.width, dimensions.height)
  const scale = Math.min(1, maxSvgRasterDimension / Math.max(dimensions.width, dimensions.height), Math.sqrt(maxSvgRasterPixels / (dimensions.width * dimensions.height)))
  const width = Math.max(1, Math.floor(dimensions.width * scale))

  await page.locator("#svg").evaluate((image: HTMLImageElement, targetWidth) => { image.style.width = `${targetWidth}px`; image.style.height = "auto" }, width)

  return new Uint8Array(await page.locator("#svg").screenshot({ type: "png", omitBackground: true, timeout: rasterTimeoutMs }))
}

function svgSource(source: Uint8Array) {
  if (source.length > maxSvgInputBytes) throw new Error(`SVG preview rejected: source exceeds the ${maxSvgInputBytes / 1024 / 1024} MiB limit.`)

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source)
  } catch {
    throw new Error("Invalid SVG: source is not valid UTF-8.")
  }

  if (!/<svg\b/i.test(text)) throw new Error("SVG preview rejected: missing SVG root element.")
  if (/<!doctype\b|<!entity\b/i.test(text)) throw new Error("SVG preview rejected: DOCTYPE and ENTITY declarations are not allowed.")
  if (/<\s*(?:script|iframe|object|embed)\b/i.test(text)) throw new Error("SVG preview rejected: executable or embedded document elements are not allowed.")
  if (/(?:xlink:)?href\s*=\s*(?:(["'])\s*(?!#)[\s\S]*?\1|(?!["'#\s])[^>\s]+)/i.test(text)) throw new Error("SVG preview rejected: external or embedded resource references are not allowed.")
  if (/@import\b/i.test(text) || hasExternalSvgCssResource(text)) throw new Error("SVG preview rejected: CSS resource references are not allowed.")

  return text
}

function svgRenderOptions(width?: number) {
  return {
    ...(width ? { fitTo: { mode: "width" as const, value: width } } : {}),
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
    background: "rgba(0, 0, 0, 0)",
  }
}

function hasExternalSvgCssResource(source: string) {
  for (const match of source.matchAll(/url\s*\(\s*([^)]*?)\s*\)/gi)) {
    const reference = match[1].trim().replace(/^['"]|['"]$/g, "")
    if (!reference.startsWith("#")) return true
  }

  return false
}

function validateSvgDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("SVG preview rejected: dimensions are invalid.")
  if (width > maxSvgSourceDimension || height > maxSvgSourceDimension || width * height > maxSvgSourcePixels) {
    throw new Error("SVG preview rejected: source dimensions exceed the preview limit.")
  }
}

async function closeBrowser(browser: Browser, context: BrowserContext) {
  await context.close()
  await browser.close()
}

function chromiumCandidates() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]
  }

  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    ]
  }

  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
}
