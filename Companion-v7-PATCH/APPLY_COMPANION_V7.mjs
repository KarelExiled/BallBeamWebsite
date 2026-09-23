import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const APP = process.cwd()
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const BACKUP = path.join(APP, `_backup_before_v7_${stamp}`)
const touched = new Map()
const warnings = []

function abs(rel) { return path.join(APP, rel) }
function exists(rel) { return fs.existsSync(abs(rel)) }
function read(rel) {
  if (!exists(rel)) throw new Error(`Missing expected Companion file: ${rel}`)
  return fs.readFileSync(abs(rel), 'utf8')
}
function backup(rel) {
  if (touched.has(rel)) return
  const src = abs(rel)
  const didExist = fs.existsSync(src)
  touched.set(rel, didExist)
  if (!didExist) return
  const dst = path.join(BACKUP, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}
function write(rel, content) {
  backup(rel)
  const p = abs(rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
}
function warn(message) { warnings.push(message); console.warn(`[v7] ${message}`) }
function mutate(rel, fn, optional = false) {
  try {
    const before = read(rel)
    const after = fn(before)
    if (typeof after !== 'string') throw new Error('patch function did not return text')
    if (after !== before) write(rel, after)
    return after !== before
  } catch (error) {
    if (optional) { warn(`${rel}: ${error instanceof Error ? error.message : String(error)}`); return false }
    throw error
  }
}
function rollback() {
  console.error('\n[v7] Rolling back changed files...')
  for (const [rel, didExist] of [...touched.entries()].reverse()) {
    try {
      const target = abs(rel)
      if (!didExist) { if (fs.existsSync(target)) fs.rmSync(target, { force: true }); continue }
      const src = path.join(BACKUP, rel)
      if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(src, target) }
    } catch (error) { console.error(`[v7] Could not restore ${rel}:`, error) }
  }
}
function replaceFunction(text, name, replacement) {
  const needles = [`export async function ${name}(`, `export function ${name}(`, `async function ${name}(`, `function ${name}(`]
  let start = -1
  for (const needle of needles) { start = text.indexOf(needle); if (start >= 0) break }
  if (start < 0) throw new Error(`function ${name} not found`)
  const brace = text.indexOf('{', start)
  if (brace < 0) throw new Error(`function ${name} opening brace not found`)
  let depth = 0, quote = '', escaped = false
  for (let i = brace; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (c === '\\') { escaped = true; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(0, start) + replacement + text.slice(i + 1)
    }
  }
  throw new Error(`function ${name} closing brace not found`)
}
function setPackageVersion(rel, version) {
  if (!exists(rel)) return
  mutate(rel, (src) => {
    try {
      const obj = JSON.parse(src)
      obj.version = version
      if (obj.packages?.['']) obj.packages[''].version = version
      return JSON.stringify(obj, null, 2) + '\n'
    } catch { return src }
  }, true)
}

const pkg = JSON.parse(read('package.json'))
if (!String(pkg.version || '').startsWith('5.') && !String(pkg.version || '').startsWith('6.') && !String(pkg.version || '').startsWith('7.')) {
  throw new Error(`Expected Companion v5/v6/v7 source, found version ${pkg.version || 'unknown'}`)
}

fs.mkdirSync(BACKUP, { recursive: true })
console.log(`[v7] Companion source: ${APP}`)
console.log(`[v7] Backup: ${BACKUP}`)

try {
  // --- Character/avatar ownership race fix ---
  mutate('src/main/character.ts', (src) => {
    if (src.includes('A generated avatar belongs to the character that started the image job')) return src
    return replaceFunction(src, 'setCharacterAvatar', `export function setCharacterAvatar(filePath: string): CharacterProfile {
  const db = getDatabase()
  let targetId = getActiveCharacter().id
  try {
    const generated = db
      .prepare('SELECT character_id FROM image_history WHERE file_path = ? ORDER BY id DESC LIMIT 1')
      .get(filePath) as { character_id?: number } | undefined
    if (generated?.character_id) targetId = Number(generated.character_id)
  } catch {
    // Uploaded/manual avatars are not in image_history; use the currently selected character.
  }
  db.prepare('UPDATE characters SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(filePath, targetId)
  const updated = getCharacterById(targetId)
  if (!updated) throw new Error('Character not found after avatar update.')
  return updated
}`)
  }, true)

  // --- Chat photo ownership race fix ---
  mutate('src/main/chat.ts', (src) => {
    if (src.includes('generated?.character_id') && src.includes('attachImageMessage')) return src
    return replaceFunction(src, 'attachImageMessage', `export function attachImageMessage(content: string, imagePath: string, kind = 'image'): ChatMessageRow {
  const db = getDatabase()
  let characterId = getActiveCharacter().id
  try {
    const generated = db
      .prepare('SELECT character_id FROM image_history WHERE file_path = ? ORDER BY id DESC LIMIT 1')
      .get(imagePath) as { character_id?: number } | undefined
    if (generated?.character_id) characterId = Number(generated.character_id)
  } catch {
    // Manual attachments keep normal active-character behavior.
  }
  const sessionId = getActiveChatSessionId(characterId)
  const result = db.prepare(
    \`INSERT INTO messages (character_id, session_id, sender, content, image_path, message_kind)
     VALUES (?, ?, 'assistant', ?, ?, ?)\`
  ).run(characterId, sessionId, content, imagePath, kind)
  touchSession(sessionId)
  return selectMessage(Number(result.lastInsertRowid))
}`)
  }, true)

  // --- Adult mode: always enabled for explicit 18+ characters ---
  mutate('src/main/settings.ts', (src) => {
    let out = src
    out = out.replace(/adult_images_enabled:\s*getBooleanSetting\((['"])adult_images_enabled\1,\s*(?:false|true)\)/g, 'adult_images_enabled: true')
    out = out.replace(/adult_images_enabled:\s*Boolean\([^\n,}]+\)/g, 'adult_images_enabled: true')
    out = out.replace(/setSetting\((['"])adult_images_enabled\1,\s*String\([^\n;]+\)\)/g, "setSetting('adult_images_enabled', 'true')")
    return out
  }, true)

  mutate('src/main/db.ts', (src) => {
    let out = src
    out = out.replace(/seedSetting\((['"])adult_images_enabled\1,\s*(['"])false\2\)/g, "seedSetting('adult_images_enabled', 'true')")
    out = out.replace(/seedSetting\((['"])adult_images_enabled\1,\s*(['"])true\2\)/g, "seedSetting('adult_images_enabled', 'true')")
    return out
  }, true)

  for (const rel of ['src/main/mediaPrompt.ts', 'src/main/images.ts', 'src/main/videos.ts']) {
    mutate(rel, (src) => {
      let out = src
      // Remove only the user setting gate. Age/consent checks stay in place.
      out = out.replace(/\s*if\s*\(\s*!settings\.adult_images_enabled\s*\)\s*\{[\s\S]*?\n\s*\}/g, '')
      out = out.replace(/\s*if\s*\(\s*!getSettings\(\)\.adult_images_enabled\s*\)\s*\{[\s\S]*?\n\s*\}/g, '')
      return out
    }, true)
  }

  // --- Human/private adult chat behavior. This permits consensual adult sexual roleplay, not minors/non-consensual exploitation. ---
  mutate('src/main/ai.ts', (src) => {
    if (src.includes('Consensual adult intimacy rule:')) return src
    const rule = `\nConsensual adult intimacy rule: when every participant is explicitly 18+, consensual sexual/romantic roleplay and explicit language are allowed. Do not moralize, euphemize, or refuse merely because adult content is sexual. Stay in character and follow the current relationship/context. Never sexualize minors, ambiguous-age people, coercion, or non-consensual exploitation.`
    const anchors = [
      'Write like a real private message, direct/relaxed/specific.',
      'Write like a real private message',
      'Avoid overexplaining',
      'Match the user energy'
    ]
    for (const anchor of anchors) {
      const i = src.indexOf(anchor)
      if (i >= 0) {
        const end = src.indexOf('\n', i)
        const pos = end >= 0 ? end : i + anchor.length
        return src.slice(0, pos) + rule + src.slice(pos)
      }
    }
    warn('Could not find the normal chat-prompt anchor in ai.ts; adult image mode still works, but the chat prompt rule was not injected.')
    return src
  }, true)

  // --- ComfyUI/Qwen handoff: don't kill ComfyUI before the completed output has been returned over IPC. ---
  for (const rel of ['src/main/images.ts', 'src/main/videos.ts']) {
    mutate(rel, (src) => {
      if (src.includes('v7 delayed media cleanup')) return src
      const patterns = [
        /if\s*\(isManaged\('images'\)\s*&&\s*!settings\.auto_start_comfy\)\s*await\s+stopService\('images'\)\s*\n\s*void\s+startService\('brain'\)/g,
        /if\s*\(isManaged\("images"\)\s*&&\s*!settings\.auto_start_comfy\)\s*await\s+stopService\("images"\)\s*\n\s*void\s+startService\("brain"\)/g
      ]
      let out = src
      let changed = false
      for (const re of patterns) {
        out = out.replace(re, () => {
          changed = true
          return `// v7 delayed media cleanup: let the IPC/fetch response fully leave ComfyUI first.
    setTimeout(() => {
      void (async () => {
        try {
          if (isManaged('images') && !settings.auto_start_comfy) await stopService('images')
        } catch (error) {
          console.warn('[media] delayed ComfyUI stop failed:', error)
        }
        try {
          await startService('brain')
        } catch (error) {
          console.warn('[media] restoring Qwen failed:', error)
        }
      })()
    }, 1200)`
        })
      }
      if (!changed) return src
      return out
    }, true)
  }

  // --- Start the phone/media-management server as a side effect ---
  mutate('src/main/index.ts', (src) => {
    if (src.includes("import './phoneServer'")) return src
    const lines = src.split(/\r?\n/)
    let at = 0
    while (at < lines.length && (lines[at].startsWith('import ') || lines[at].trim() === '')) at++
    lines.splice(at, 0, "import './phoneServer'")
    return lines.join('\n')
  })

  // --- Desktop Media Inspector overlay ---
  mutate('src/renderer/index.html', (src) => {
    if (src.includes('/src/v7Overlay.ts')) return src
    if (!src.includes('</body>')) throw new Error('renderer index.html has no </body> tag')
    return src.replace('</body>', '  <script type="module" src="/src/v7Overlay.ts"></script>\n</body>')
  })

  const phoneServer = String.raw`import { app } from 'electron'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { randomInt } from 'node:crypto'
import * as dbMod from './db'
import * as characterMod from './character'
import * as chatMod from './chat'
import * as settingsMod from './settings'
import * as imageMod from './images'
import * as videoMod from './videos'

const PORT = 8765
let started = false
const failedAuth = new Map<string, { count: number; until: number }>()

function db(): any { return (dbMod as any).getDatabase() }
function getSetting(key: string): any { return (dbMod as any).getSetting?.(key) }
function setSetting(key: string, value: string): void { (dbMod as any).setSetting?.(key, value) }
function active(): any { return (characterMod as any).getActiveCharacter() }
function chars(): any[] { return (characterMod as any).listCharacters?.() || [] }

function token(): string {
  let value = String(getSetting('phone_access_pin') || '')
  if (!/^\d{8}$/.test(value)) {
    value = String(randomInt(10000000, 100000000))
    setSetting('phone_access_pin', value)
  }
  return value
}

function loopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress || ''
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}
function ip(req: IncomingMessage): string { return req.socket.remoteAddress || 'unknown' }
function allowed(req: IncomingMessage, body?: any): boolean {
  if (loopback(req)) return true
  const key = ip(req)
  const fail = failedAuth.get(key)
  if (fail && fail.until > Date.now()) return false
  const url = new URL(req.url || '/', 'http://localhost')
  const ok = url.searchParams.get('pin') === token() || String(body?.pin || '') === token()
  if (ok) { failedAuth.delete(key); return true }
  const count = (fail?.count || 0) + 1
  failedAuth.set(key, { count, until: count >= 8 ? Date.now() + 60_000 : 0 })
  return false
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
}
function json(res: ServerResponse, status: number, value: unknown): void {
  cors(res)
  const body = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function parseMeta(value: any): any {
  if (!value) return {}
  if (typeof value === 'object') return value
  try { return JSON.parse(String(value)) } catch { return {} }
}
function firstNumber(...values: any[]): number | null {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}
function gallery(characterId: number): any[] {
  try {
    const rows = db().prepare('SELECT * FROM image_history WHERE character_id = ? ORDER BY id DESC LIMIT 200').all(characterId) as any[]
    return rows.map((row) => {
      const meta = parseMeta(row.metadata_json)
      const prompt = row.prompt || meta.final_prompt || meta.prompt || meta.request_prompt || ''
      const requestPrompt = meta.request_prompt || meta.user_prompt || row.request_prompt || prompt
      const seed = firstNumber(row.seed, meta.seed, meta.noise_seed, meta.random_seed)
      return {
        ...row,
        file_path: undefined,
        metadata: meta,
        prompt,
        request_prompt: requestPrompt,
        seed,
        media_url: '/media/gallery/' + row.id
      }
    })
  } catch { return [] }
}
function messages(characterId: number): any[] {
  try {
    const fn = (chatMod as any).getChatHistory
    const rows = typeof fn === 'function' ? fn() : db().prepare('SELECT * FROM messages WHERE character_id = ? ORDER BY id ASC').all(characterId)
    return (rows || []).map((m: any) => ({ ...m, image_url: m.image_path ? '/media/chat/' + m.id : null }))
  } catch { return [] }
}
function sessions(characterId: number): any[] {
  try {
    const fn = (chatMod as any).listChatSessions
    if (typeof fn === 'function') return fn() || []
    return db().prepare('SELECT * FROM chat_sessions WHERE character_id = ? ORDER BY updated_at DESC, id DESC').all(characterId) as any[]
  } catch { return [] }
}
function state(): any {
  const a = active()
  return { active: a, characters: chars(), sessions: sessions(a.id), messages: messages(a.id), gallery: gallery(a.id), adult_mode: true }
}
function mediaPathFromResult(result: any): string {
  const value = result?.file_path || result?.filePath || result?.path || result?.filename
  if (!value) throw new Error('Generation completed but Companion did not return a media file path.')
  return String(value)
}
function currentGalleryRow(filePath: string): any {
  try { return db().prepare('SELECT * FROM image_history WHERE file_path = ? ORDER BY id DESC LIMIT 1').get(filePath) } catch { return null }
}
function enrich(filePath: string, requestedPrompt: string, seed: number, options: any): void {
  try {
    const row = currentGalleryRow(filePath)
    if (!row) return
    const meta = { ...parseMeta(row.metadata_json), request_prompt: requestedPrompt, seed, v7_options: options, generated_at: new Date().toISOString() }
    db().prepare('UPDATE image_history SET metadata_json = ? WHERE id = ?').run(JSON.stringify(meta), row.id)
  } catch (error) { console.warn('[v7] could not enrich media metadata', error) }
}
function assertAdultCharacter(character: any): void {
  const age = Number(character?.age)
  if (!Number.isFinite(age) || age < 18) throw new Error('Adult content is available only when the character has an explicit age of 18+.')
}
function requestedAdult(text: string): boolean {
  return /\b(nsfw|nude|naked|topless|lingerie|erotic|explicit|sexual|sex|breast|nipple|genital|penis|vagina|pussy|blowjob|masturbat|orgasm|cum|cock|dick)\b/i.test(text)
}
function settings(): any { return (settingsMod as any).getSettings?.() || {} }
function randomSeed(): number { return randomInt(1, 2_147_483_000) }

async function makePhoto(request: any, avatar = false): Promise<any> {
  const characterAtStart = active()
  const prompt = String(request.prompt || (avatar ? 'photorealistic profile avatar' : 'a natural candid photo right now'))
  if (requestedAdult(prompt)) assertAdultCharacter(characterAtStart)
  const seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : randomSeed()
  const width = Math.max(512, Math.min(1536, Number(request.width) || (avatar ? 768 : 768)))
  const height = Math.max(512, Math.min(1536, Number(request.height) || (avatar ? 1024 : 1024)))
  const quality = String(request.quality || settings().image_quality || 'hd')
  const mode = String(request.mode || (avatar ? 'portrait' : 'candid'))
  const opts = {
    seed,
    randomSeed: false,
    useCurrentLocation: Boolean(request.useCurrentLocation ?? !avatar),
    useCurrentClothing: Boolean(request.useCurrentClothing ?? !avatar),
    useCurrentActivity: Boolean(request.useCurrentActivity ?? !avatar),
    useReference: Boolean(request.useReference ?? true),
    negativePrompt: String(request.negativePrompt || ''),
    steps: request.steps == null ? undefined : Number(request.steps),
    cfg: request.cfg == null ? undefined : Number(request.cfg)
  }
  const fn: any = (imageMod as any).generateCompanionImageManaged
  if (typeof fn !== 'function') throw new Error('Image generator is not available.')
  const result = await fn(prompt, mode, width, height, quality, undefined, opts)
  const filePath = mediaPathFromResult(result)
  enrich(filePath, prompt, seed, opts)
  if (avatar) {
    // Lock the result to the character that started the job, even if the UI switched meanwhile.
    db().prepare('UPDATE characters SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(filePath, characterAtStart.id)
  } else {
    const attach: any = (chatMod as any).attachImageMessage
    if (typeof attach === 'function') attach('📷', filePath, 'image')
  }
  return { result, filePath, seed, character_id: characterAtStart.id }
}

async function makeVideo(request: any): Promise<any> {
  const characterAtStart = active()
  const prompt = String(request.prompt || 'a short natural video right now')
  if (requestedAdult(prompt)) assertAdultCharacter(characterAtStart)
  const seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : randomSeed()
  const fn: any = (videoMod as any).generateCompanionVideoManaged
  if (typeof fn !== 'function') throw new Error('Video generator is not available.')
  const opts = { seed, randomSeed: false, frames: request.frames == null ? undefined : Number(request.frames), fps: request.fps == null ? undefined : Number(request.fps), motion: request.motion == null ? undefined : Number(request.motion), useReference: Boolean(request.useReference ?? true), negativePrompt: String(request.negativePrompt || '') }
  const result = await fn(prompt, opts)
  const filePath = mediaPathFromResult(result)
  enrich(filePath, prompt, seed, opts)
  const attach: any = (chatMod as any).attachImageMessage
  if (typeof attach === 'function') attach('🎬', filePath, 'video')
  return { result, filePath, seed, character_id: characterAtStart.id }
}

function safeGeneratedPath(filePath: string): boolean {
  const p = filePath.toLowerCase()
  return p.includes('generated-image') || p.includes('generated_image') || p.includes('generated-video') || p.includes('generated_video') || p.includes('generated-media') || p.includes('generated_media')
}
function deleteMedia(id: number): void {
  const row = db().prepare('SELECT * FROM image_history WHERE id = ?').get(id) as any
  if (!row) return
  const filePath = String(row.file_path || '')
  try { db().prepare('UPDATE characters SET avatar_path = NULL WHERE avatar_path = ?').run(filePath) } catch {}
  try { db().prepare('DELETE FROM messages WHERE image_path = ?').run(filePath) } catch {}
  db().prepare('DELETE FROM image_history WHERE id = ?').run(id)
  if (filePath && safeGeneratedPath(filePath)) { try { if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true }) } catch {} }
}
function deleteMessage(id: number): void { try { db().prepare('DELETE FROM messages WHERE id = ?').run(id) } catch {} }
function deleteSession(id: number): void {
  try { db().prepare('DELETE FROM messages WHERE session_id = ?').run(id) } catch {}
  try { db().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id) } catch {}
}
function clearCharacterHistory(characterId: number): void {
  try { db().prepare('DELETE FROM messages WHERE character_id = ?').run(characterId) } catch {}
  try { db().prepare('DELETE FROM chat_sessions WHERE character_id = ?').run(characterId) } catch {}
}
function deleteCharacter(id: number): void {
  const fn: any = (characterMod as any).deleteCharacter
  if (typeof fn === 'function') { fn(id); return }
  const count = Number(db().prepare('SELECT COUNT(*) AS n FROM characters').get()?.n || 0)
  if (count <= 1) throw new Error('Keep at least one character.')
  try { db().prepare('DELETE FROM messages WHERE character_id = ?').run(id) } catch {}
  try { db().prepare('DELETE FROM image_history WHERE character_id = ?').run(id) } catch {}
  try { db().prepare('DELETE FROM chat_sessions WHERE character_id = ?').run(id) } catch {}
  db().prepare('DELETE FROM characters WHERE id = ?').run(id)
}

function mime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  return 'application/octet-stream'
}
function stream(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  if (!filePath || !fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return }
  const stat = fs.statSync(filePath)
  const range = req.headers.range
  cors(res)
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range)
    if (m) {
      const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
      res.writeHead(206, { 'Content-Type': mime(filePath), 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 })
      fs.createReadStream(filePath, { start, end }).pipe(res); return
    }
  }
  res.writeHead(200, { 'Content-Type': mime(filePath), 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' })
  fs.createReadStream(filePath).pipe(res)
}

const html = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Companion</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#eee;background:#0e0e12}*{box-sizing:border-box}body{margin:0;background:#0e0e12;color:#eee}button,input,select,textarea{font:inherit}button{cursor:pointer;background:#292933;color:#fff;border:1px solid #3b3b47;border-radius:10px;padding:9px 11px}.top{position:sticky;top:0;z-index:5;background:#18181f;border-bottom:1px solid #2c2c36;padding:10px;display:flex;gap:8px;align-items:center}.top select{flex:1;background:#222;color:#fff;border:1px solid #444;border-radius:9px;padding:8px}.status{padding:7px 12px;font-size:12px;color:#aaa;border-bottom:1px solid #24242c}.messages{padding:12px 12px 100px;display:flex;flex-direction:column;gap:10px}.msg{max-width:90%;padding:10px 12px;border-radius:15px;background:#22222b}.me{align-self:flex-end;background:#35304b}.meta{font-size:11px;color:#9a9aa6;margin-bottom:4px}.msg img,.msg video{width:100%;max-height:520px;object-fit:contain;border-radius:10px;margin-top:7px}.composer{position:fixed;bottom:0;left:0;right:0;background:#17171d;border-top:1px solid #292933;padding:9px;display:flex;gap:7px}.composer textarea{flex:1;resize:none;max-height:120px;border:1px solid #373743;border-radius:12px;background:#22222a;color:#fff;padding:10px}.actions{display:flex;gap:6px;overflow:auto;padding:7px 10px;background:#15151b}.gallery{padding:10px;display:grid;grid-template-columns:1fr;gap:10px}.card{background:#191920;border:1px solid #292933;border-radius:12px;padding:8px}.card img,.card video{width:100%;border-radius:9px;background:#000;max-height:560px;object-fit:contain}.details{font-size:12px;color:#bbb;white-space:pre-wrap;word-break:break-word;padding:6px 2px}.danger{border-color:#6f3030!important;color:#ffb0b0!important}.hidden{display:none}.login{max-width:360px;margin:18vh auto;padding:20px}.login input,.modal input,.modal textarea,.modal select{width:100%;padding:10px;background:#222;color:#fff;border:1px solid #444;border-radius:9px;margin:4px 0 9px}.modal{position:fixed;inset:0;background:#000b;z-index:20;display:flex;align-items:center;justify-content:center;padding:12px}.modalbox{width:min(620px,100%);max-height:92vh;overflow:auto;background:#17171d;border:1px solid #333;border-radius:14px;padding:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.hidden{display:none!important}@media(min-width:800px){.messages,.actions,.top,.status,.composer{max-width:780px;margin-left:auto;margin-right:auto}.composer{left:50%;transform:translateX(-50%);width:780px}.gallery{max-width:900px;margin:auto;grid-template-columns:repeat(2,1fr)}}
</style></head><body><div id="login" class="login hidden"><h2>Companion phone access</h2><p>Enter the 8-digit code shown by Companion on your PC.</p><input id="pinInput" inputmode="numeric" maxlength="8"><button onclick="savePin()">Connect</button></div><div id="app"><div class="top"><select id="character" onchange="switchCharacter()"></select><button onclick="newChat()">New chat</button><button onclick="toggleGallery()">Gallery</button></div><div id="status" class="status"></div><div class="actions"><button onclick="openPhoto(false)">📷 Photo</button><button onclick="openVideo()">🎬 Video</button><button onclick="openPhoto(true)">👤 Avatar</button><button onclick="pickHistory()">History</button><button onclick="clearHistory()" class="danger">Clear chat</button><button onclick="refresh()">↻</button></div><div id="messages" class="messages"></div><div id="gallery" class="gallery hidden"></div><div class="composer"><textarea id="text" rows="1" placeholder="Message…"></textarea><button onclick="send()">Send</button></div></div><div id="modal" class="modal hidden"><div class="modalbox"><h3 id="modalTitle">Generate</h3><label>Prompt</label><textarea id="pPrompt" rows="4"></textarea><div class="grid"><div><label>Seed (blank = random)</label><input id="pSeed" inputmode="numeric"></div><div><label>Quality</label><select id="pQuality"><option>hd</option><option>fast</option></select></div><div><label>Width</label><input id="pWidth" value="768"></div><div><label>Height</label><input id="pHeight" value="1024"></div><div><label>Mode</label><select id="pMode"><option>candid</option><option>selfie</option><option>portrait</option><option>scene</option></select></div><div><label>Steps</label><input id="pSteps" placeholder="auto"></div></div><label>Negative prompt</label><textarea id="pNeg" rows="2"></textarea><label><input id="pLoc" type="checkbox" checked> use current location</label> <label><input id="pClothes" type="checkbox" checked> use current outfit</label> <label><input id="pActivity" type="checkbox" checked> use current activity</label><br><label><input id="pRef" type="checkbox" checked> character reference</label><div style="display:flex;gap:8px;margin-top:12px"><button onclick="runGenerate()">Generate</button><button onclick="closeModal()">Cancel</button></div></div></div><script>
let pin=new URLSearchParams(location.search).get('pin')||localStorage.getItem('companionPin')||'';let S=null;let galleryOpen=false;let genKind='photo';const $=id=>document.getElementById(id);const q=u=>u+(u.includes('?')?'&':'?')+'pin='+encodeURIComponent(pin);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function savePin(){pin=$('pinInput').value.trim();localStorage.setItem('companionPin',pin);$('login').classList.add('hidden');$('app').classList.remove('hidden');refresh()}async function api(url,opt={}){const r=await fetch(q(url),{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});if(r.status===401){$('login').classList.remove('hidden');$('app').classList.add('hidden');throw Error('PIN required')}if(!r.ok)throw Error(await r.text());return r.json()}async function post(url,obj={}){return api(url,{method:'POST',body:JSON.stringify({...obj,pin})})}function fmt(t){try{return new Date(t).toLocaleString()}catch{return t||''}}function mediaType(g){return String(g.image_type||g.media_type||g.kind||'').toLowerCase().includes('video')||/\.(mp4|webm|mov)$/i.test(String(g.filename||''))?'video':'image'}function render(){if(!S)return;$('character').innerHTML=S.characters.map(c=>`<option value="${c.id}" ${c.id===S.active.id?'selected':''}>${esc(c.name)}</option>`).join('');$('status').textContent=[S.active.name,S.active.current_location||S.active.location,S.active.current_activity,'18+ mode ON for adults'].filter(Boolean).join(' • ');$('messages').innerHTML=S.messages.map(m=>`<div class="msg ${m.sender==='user'?'me':''}"><div class="meta">${esc(m.sender==='user'?'You':S.active.name)} • ${esc(fmt(m.created_at))}</div><div>${esc(m.content)}</div>${m.image_url?`<img src="${q(m.image_url)}">`:''}<div style="margin-top:6px"><button class="danger" onclick="delMsg(${m.id})">Delete</button></div></div>`).join('');$('gallery').innerHTML=S.gallery.map(g=>{const u=q(g.media_url),t=mediaType(g),meta=g.metadata||{};const details=`Request: ${g.request_prompt||''}\nFinal prompt: ${g.prompt||''}\nSeed: ${g.seed??'unknown'}\nSettings: ${JSON.stringify(meta.v7_options||meta,null,2)}`;return `<div class="card">${t==='video'?`<video src="${u}" controls playsinline></video>`:`<img src="${u}" loading="lazy">`}<div class="details">${esc(details)}</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button onclick="reuse(${g.id})">Reuse prompt/seed</button><button class="danger" onclick="delMedia(${g.id})">Delete</button></div></div>`}).join('');requestAnimationFrame(()=>scrollTo(0,document.body.scrollHeight))}async function refresh(){try{S=await api('/api/state');render()}catch(e){console.error(e)}}async function switchCharacter(){await post('/api/switch-character',{id:Number($('character').value)});refresh()}async function send(){const el=$('text'),text=el.value.trim();if(!text)return;el.value='';await post('/api/send',{text});refresh()}async function newChat(){await post('/api/new-chat',{});refresh()}function toggleGallery(){galleryOpen=!galleryOpen;$('gallery').classList.toggle('hidden',!galleryOpen);$('messages').classList.toggle('hidden',galleryOpen)}function openPhoto(avatar){genKind=avatar?'avatar':'photo';$('modalTitle').textContent=avatar?'Create avatar':'Create photo';$('pPrompt').value=avatar?'photorealistic attractive profile portrait, natural skin texture, same exact woman':'a natural candid photo right now';$('pMode').value=avatar?'portrait':'candid';$('pLoc').checked=!avatar;$('pClothes').checked=!avatar;$('pActivity').checked=!avatar;$('modal').classList.remove('hidden')}function openVideo(){genKind='video';$('modalTitle').textContent='Create video';$('pPrompt').value='a short natural video right now';$('modal').classList.remove('hidden')}function closeModal(){$('modal').classList.add('hidden')}async function runGenerate(){const data={prompt:$('pPrompt').value,seed:$('pSeed').value?Number($('pSeed').value):undefined,quality:$('pQuality').value,width:Number($('pWidth').value),height:Number($('pHeight').value),mode:$('pMode').value,steps:$('pSteps').value?Number($('pSteps').value):undefined,negativePrompt:$('pNeg').value,useCurrentLocation:$('pLoc').checked,useCurrentClothing:$('pClothes').checked,useCurrentActivity:$('pActivity').checked,useReference:$('pRef').checked};closeModal();await post(genKind==='avatar'?'/api/avatar':genKind==='video'?'/api/video':'/api/photo',data);refresh()}async function delMedia(id){if(confirm('Delete this generated media?')){await post('/api/delete-media',{id});refresh()}}async function delMsg(id){if(confirm('Delete this message?')){await post('/api/delete-message',{id});refresh()}}async function clearHistory(){if(confirm('Delete all chat history for this character?')){await post('/api/clear-history',{});refresh()}}function reuse(id){const g=S.gallery.find(x=>x.id===id);if(!g)return;openPhoto(mediaType(g)==='video'?false:false);genKind=mediaType(g)==='video'?'video':'photo';$('modalTitle').textContent='Reuse prompt / seed';$('pPrompt').value=g.request_prompt||g.prompt||'';$('pSeed').value=g.seed??''}async function pickHistory(){if(!S?.sessions?.length)return alert('No history yet');const list=S.sessions.map(x=>x.id+': '+(x.title||x.updated_at||x.created_at)).join('\n');const id=Number(prompt('Chat history – enter ID:\n'+list,''));if(id){await post('/api/switch-chat',{id});refresh()}}$('text').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});if(!pin){$('login').classList.remove('hidden');$('app').classList.add('hidden')}else{localStorage.setItem('companionPin',pin);refresh();setInterval(refresh,2500)}
</script></body></html>`

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return }
  const url = new URL(req.url || '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/') { cors(res); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return }
  let data: any = {}
  if (req.method === 'POST') { try { data = await body(req) } catch { json(res, 400, { error: 'Invalid JSON' }); return } }
  if (!allowed(req, data)) { json(res, 401, { error: 'PIN required or temporarily locked after too many attempts' }); return }
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') { json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/switch-character') { (characterMod as any).setActiveCharacter?.(Number(data.id)); json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/send') { const fn: any=(chatMod as any).sendChatMessage; if(typeof fn!=='function') throw new Error('Chat send function unavailable'); await fn(String(data.text||'')); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/new-chat') { const fn: any=(chatMod as any).startNewChat; if(typeof fn==='function') await fn(); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/switch-chat') { const fn: any=(chatMod as any).switchChatSession; if(typeof fn==='function') await fn(Number(data.id)); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/photo') { const out=await makePhoto(data,false); json(res,200,{...out,state:state()}); return }
    if (req.method === 'POST' && url.pathname === '/api/avatar') { const out=await makePhoto(data,true); json(res,200,{...out,state:state()}); return }
    if (req.method === 'POST' && url.pathname === '/api/video') { const out=await makeVideo(data); json(res,200,{...out,state:state()}); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-media') { deleteMedia(Number(data.id)); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-message') { deleteMessage(Number(data.id)); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-session') { deleteSession(Number(data.id)); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/clear-history') { clearCharacterHistory(active().id); json(res,200,state()); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-character') { deleteCharacter(Number(data.id)); json(res,200,state()); return }
    const gm=/^\/media\/gallery\/(\d+)$/.exec(url.pathname)
    if (req.method==='GET'&&gm) { const row=db().prepare('SELECT file_path FROM image_history WHERE id=?').get(Number(gm[1])) as any; if(!row?.file_path){res.writeHead(404);res.end('Not found');return} stream(req,res,row.file_path); return }
    const cm=/^\/media\/chat\/(\d+)$/.exec(url.pathname)
    if (req.method==='GET'&&cm) { const row=db().prepare('SELECT image_path FROM messages WHERE id=?').get(Number(cm[1])) as any; if(!row?.image_path){res.writeHead(404);res.end('Not found');return} stream(req,res,row.image_path); return }
    json(res,404,{error:'Not found'})
  } catch (error) {
    console.error('[phone/v7]', error)
    json(res,500,{error:error instanceof Error?error.message:String(error)})
  }
}

function urls(code: string): string[] {
  const out: string[]=[]
  for(const rows of Object.values(os.networkInterfaces())) for(const n of rows||[]) if(n.family==='IPv4'&&!n.internal) out.push(`http://${n.address}:${PORT}/?pin=${code}`)
  return [...new Set(out)]
}
export function startPhoneServer(): void {
  if(started)return;started=true
  const code=token()
  const server=http.createServer((req,res)=>{void handler(req,res)})
  server.on('error',(e)=>console.error('[phone/v7] server error',e))
  server.listen(PORT,'0.0.0.0',()=>{
    const list=urls(code)
    const text=['COMPANION PHONE ACCESS','','Keep Companion running on this PC.','Use a URL below on your phone while on the same Wi-Fi or Tailscale.','Do NOT port-forward port 8765 to the public internet.','',...list,'',`ACCESS CODE: ${code}`,'','Everything (Qwen, ComfyUI, database, chats, images and videos) stays on this PC.'].join('\r\n')
    try{fs.writeFileSync(path.join(process.cwd(),'PHONE_ACCESS.txt'),text,'utf8')}catch{}
    console.log('[phone/v7] '+(list[0]||`http://127.0.0.1:${PORT}`))
  })
}
if(app.isReady()) startPhoneServer(); else void app.whenReady().then(()=>startPhoneServer())
`
  write('src/main/phoneServer.ts', phoneServer)

  const overlay = String.raw`// Companion v7 desktop Media Inspector. Uses the local PC-only API on port 8765.
const API = 'http://127.0.0.1:8765'
let panel: HTMLDivElement | null = null
let state: any = null

function esc(v: any): string { return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as any)[c]) }
async function api(path: string, body?: any): Promise<any> {
  const res = await fetch(API + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
function css(): void {
  if (document.getElementById('v7-style')) return
  const s=document.createElement('style');s.id='v7-style';s.textContent=`#v7btn{position:fixed;right:18px;bottom:88px;z-index:99990;border:1px solid #555;background:#202027;color:#fff;border-radius:999px;padding:10px 14px;font:13px system-ui;box-shadow:0 8px 30px #0008}#v7panel{position:fixed;inset:5vh 3vw;z-index:99999;background:#121217;color:#eee;border:1px solid #444;border-radius:16px;box-shadow:0 20px 80px #000d;overflow:auto;font:13px system-ui;padding:14px}#v7panel button,#v7panel input,#v7panel textarea,#v7panel select{font:inherit}#v7panel button{background:#292933;color:#fff;border:1px solid #444;border-radius:8px;padding:7px 9px;cursor:pointer}#v7panel .danger{border-color:#733;color:#fbb}#v7panel .head{display:flex;align-items:center;gap:8px;position:sticky;top:-14px;background:#121217;padding:10px 0;z-index:3}#v7panel .head h2{flex:1;margin:0}#v7panel .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}#v7panel .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}#v7panel .card{background:#1b1b22;border:1px solid #30303a;border-radius:12px;padding:8px}#v7panel img,#v7panel video{width:100%;max-height:360px;object-fit:contain;background:#000;border-radius:8px}#v7panel pre{white-space:pre-wrap;word-break:break-word;color:#bbb;font:11px ui-monospace,monospace}#v7panel label{display:block;color:#bbb;margin-top:6px}#v7panel input,#v7panel textarea,#v7panel select{width:100%;background:#22222a;color:#fff;border:1px solid #444;border-radius:8px;padding:8px}#v7panel .form{max-width:720px;margin:auto}#v7panel .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}`;document.head.appendChild(s)
}
function button(): void { if(document.getElementById('v7btn'))return;const b=document.createElement('button');b.id='v7btn';b.textContent='Media / Prompt / Delete';b.onclick=()=>open('gallery');document.body.appendChild(b) }
function close(): void { panel?.remove();panel=null }
async function refresh(): Promise<void> { state=await api('/api/state') }
async function open(tab='gallery'): Promise<void> { css();await refresh();close();panel=document.createElement('div');panel.id='v7panel';document.body.appendChild(panel);render(tab) }
function shell(tab:string,body:string):string{return `<div class="head"><h2>Companion v7 • ${esc(state?.active?.name)}</h2><span>18+ mode: ON for adults</span><button id="v7close">Close</button></div><div class="tabs"><button data-tab="gallery">Gallery + prompt/seed</button><button data-tab="generate">Generate photo</button><button data-tab="avatar">Create avatar</button><button data-tab="chat">Chat delete</button><button data-tab="characters">Characters</button></div>${body}`}
function wireTabs():void{document.getElementById('v7close')!.onclick=close;panel!.querySelectorAll('[data-tab]').forEach((b:any)=>b.onclick=()=>render(b.dataset.tab))}
function render(tab:string):void{if(!panel)return;if(tab==='gallery')gallery();else if(tab==='generate')form(false);else if(tab==='avatar')form(true);else if(tab==='chat')chat();else characters()}
function gallery():void{const cards=(state.gallery||[]).map((g:any)=>{const type=String(g.image_type||g.media_type||'').includes('video')?'video':'image';const url=API+g.media_url;const meta=g.metadata||{};return `<div class="card">${type==='video'?`<video src="${url}" controls></video>`:`<img src="${url}">`}<b>${esc(g.image_type||'image')}</b><pre>REQUEST:\n${esc(g.request_prompt||'')}\n\nFINAL PROMPT:\n${esc(g.prompt||'')}\n\nSEED: ${esc(g.seed??'unknown')}\n\nSETTINGS:\n${esc(JSON.stringify(meta.v7_options||meta,null,2))}</pre><button data-reuse="${g.id}">Reuse prompt + seed</button> <button class="danger" data-delmedia="${g.id}">Delete</button></div>`}).join('');panel!.innerHTML=shell('gallery',`<div class="grid">${cards||'<p>No generated media yet.</p>'}</div>`);wireTabs();panel!.querySelectorAll('[data-delmedia]').forEach((b:any)=>b.onclick=async()=>{if(confirm('Delete this generated image/video?')){await api('/api/delete-media',{id:Number(b.dataset.delmedia)});await open('gallery')}});panel!.querySelectorAll('[data-reuse]').forEach((b:any)=>b.onclick=()=>{const g=state.gallery.find((x:any)=>x.id===Number(b.dataset.reuse));form(false,g)})}
function form(avatar:boolean,reuse?:any):void{const p=reuse?.request_prompt||reuse?.prompt||(avatar?'photorealistic attractive profile portrait, natural skin texture, same exact woman':'a natural candid photo right now');panel!.innerHTML=shell(avatar?'avatar':'generate',`<div class="form"><label>Prompt</label><textarea id="v7prompt" rows="5">${esc(p)}</textarea><div class="two"><div><label>Seed (blank=random)</label><input id="v7seed" value="${esc(reuse?.seed??'')}"></div><div><label>Quality</label><select id="v7quality"><option>hd</option><option>fast</option></select></div><div><label>Mode</label><select id="v7mode"><option>candid</option><option>selfie</option><option ${avatar?'selected':''}>portrait</option><option>scene</option></select></div><div><label>Steps</label><input id="v7steps" placeholder="auto"></div><div><label>Width</label><input id="v7width" value="768"></div><div><label>Height</label><input id="v7height" value="1024"></div></div><label>Negative prompt</label><textarea id="v7neg" rows="2"></textarea><div><label><input id="v7ref" type="checkbox" checked style="width:auto"> use character reference</label><label><input id="v7loc" type="checkbox" ${avatar?'':'checked'} style="width:auto"> use current location</label><label><input id="v7clothes" type="checkbox" ${avatar?'':'checked'} style="width:auto"> use current outfit</label><label><input id="v7act" type="checkbox" ${avatar?'':'checked'} style="width:auto"> use current activity</label></div><button id="v7go">${avatar?'Generate + set avatar':'Generate photo'}</button></div>`);wireTabs();(document.getElementById('v7go') as HTMLButtonElement).onclick=async()=>{const val=(id:string)=>(document.getElementById(id) as HTMLInputElement).value;const checked=(id:string)=>(document.getElementById(id) as HTMLInputElement).checked;const data={prompt:val('v7prompt'),seed:val('v7seed')?Number(val('v7seed')):undefined,quality:val('v7quality'),mode:val('v7mode'),steps:val('v7steps')?Number(val('v7steps')):undefined,width:Number(val('v7width')),height:Number(val('v7height')),negativePrompt:val('v7neg'),useReference:checked('v7ref'),useCurrentLocation:checked('v7loc'),useCurrentClothing:checked('v7clothes'),useCurrentActivity:checked('v7act')};(document.getElementById('v7go') as HTMLButtonElement).disabled=true;(document.getElementById('v7go') as HTMLButtonElement).textContent='Generating…';try{await api(avatar?'/api/avatar':'/api/photo',data);await open('gallery')}catch(e:any){alert(e?.message||e);render(avatar?'avatar':'generate')}}}
function chat():void{const rows=(state.messages||[]).map((m:any)=>`<div class="card"><b>${esc(m.sender)} • ${esc(m.created_at||'')}</b><div>${esc(m.content)}</div><button class="danger" data-delmsg="${m.id}">Delete message</button></div>`).join('');panel!.innerHTML=shell('chat',`<p><button id="v7clear" class="danger">Delete ALL chat history for ${esc(state.active.name)}</button></p><div class="grid">${rows||'<p>No messages.</p>'}</div>`);wireTabs();document.getElementById('v7clear')!.onclick=async()=>{if(confirm('Delete all chat history for this character?')){await api('/api/clear-history',{});await open('chat')}};panel!.querySelectorAll('[data-delmsg]').forEach((b:any)=>b.onclick=async()=>{if(confirm('Delete this message?')){await api('/api/delete-message',{id:Number(b.dataset.delmsg)});await open('chat')}})}
function characters():void{const rows=(state.characters||[]).map((c:any)=>`<div class="card"><b>${esc(c.name)}</b><div>Age: ${esc(c.age??'not set')}</div><button class="danger" data-delchar="${c.id}" ${c.id===state.active.id?'disabled title="Switch away first"':''}>Delete character</button></div>`).join('');panel!.innerHTML=shell('characters',`<div class="grid">${rows}</div>`);wireTabs();panel!.querySelectorAll('[data-delchar]').forEach((b:any)=>b.onclick=async()=>{if(confirm('Delete this character and its local data?')){await api('/api/delete-character',{id:Number(b.dataset.delchar)});await open('characters')}})}
css();button();setInterval(button,1500)
export {}
`
  write('src/renderer/src/v7Overlay.ts', overlay)

  // package version only; no new npm dependency is introduced.
  setPackageVersion('package.json', '7.0.0')
  setPackageVersion('package-lock.json', '7.0.0')

  console.log('\n[v7] Update files applied.')
  if (warnings.length) console.log(`[v7] ${warnings.length} non-fatal patch warning(s) were recorded.`)
  console.log('[v7] Run: npm.cmd run typecheck')
  console.log('[v7] Then start Companion normally with START_COMPANION.bat')
  console.log('[v7] Phone access will be written to C:\\AI\\Companion\\app\\PHONE_ACCESS.txt')
} catch (error) {
  console.error('\n[v7] UPDATE FAILED:', error)
  rollback()
  process.exitCode = 1
}
