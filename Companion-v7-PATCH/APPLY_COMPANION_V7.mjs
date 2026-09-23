import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = process.cwd()
const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url))
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
  const target = abs(rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}
function copyPatchFile(sourceName, targetRel) {
  const source = path.join(PATCH_DIR, sourceName)
  if (!fs.existsSync(source)) throw new Error(`Updater package is missing ${sourceName}`)
  write(targetRel, fs.readFileSync(source, 'utf8'))
}
function warn(message) {
  warnings.push(message)
  console.warn(`[v7] ${message}`)
}
function mutate(rel, fn, optional = false) {
  try {
    const before = read(rel)
    const after = fn(before)
    if (typeof after !== 'string') throw new Error('patch function did not return text')
    if (after !== before) write(rel, after)
    return after !== before
  } catch (error) {
    if (optional) {
      warn(`${rel}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    throw error
  }
}
function rollback() {
  console.error('\n[v7] Rolling back changed files...')
  for (const [rel, didExist] of [...touched.entries()].reverse()) {
    try {
      const target = abs(rel)
      if (!didExist) {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true })
        continue
      }
      const source = path.join(BACKUP, rel)
      if (fs.existsSync(source)) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(source, target)
      }
    } catch (error) {
      console.error(`[v7] Could not restore ${rel}:`, error)
    }
  }
}
function replaceFunction(text, name, replacement) {
  const needles = [
    `export async function ${name}(`,
    `export function ${name}(`,
    `async function ${name}(`,
    `function ${name}(`
  ]
  let start = -1
  for (const needle of needles) {
    start = text.indexOf(needle)
    if (start >= 0) break
  }
  if (start < 0) throw new Error(`function ${name} not found`)
  const brace = text.indexOf('{', start)
  if (brace < 0) throw new Error(`function ${name} opening brace not found`)
  let depth = 0
  let quote = ''
  let escaped = false
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
    } catch {
      return src
    }
  }, true)
}

const pkg = JSON.parse(read('package.json'))
const current = String(pkg.version || '')
if (!current.startsWith('5.') && !current.startsWith('6.') && !current.startsWith('7.')) {
  throw new Error(`Expected Companion v5/v6/v7 source, found ${current || 'unknown'}`)
}

fs.mkdirSync(BACKUP, { recursive: true })
console.log(`[v7] Updating ${APP}`)
console.log(`[v7] Backup: ${BACKUP}`)

try {
  // Fix the Lena/Jade race: a generated avatar belongs to the character recorded in image_history.
  mutate('src/main/character.ts', (src) => {
    if (src.includes('SELECT character_id FROM image_history WHERE file_path = ? ORDER BY id DESC LIMIT 1')) return src
    return replaceFunction(src, 'setCharacterAvatar', `export function setCharacterAvatar(filePath: string): CharacterProfile {
  const db = getDatabase()
  let targetId = getActiveCharacter().id
  try {
    const generated = db
      .prepare('SELECT character_id FROM image_history WHERE file_path = ? ORDER BY id DESC LIMIT 1')
      .get(filePath) as { character_id?: number } | undefined
    if (generated?.character_id) targetId = Number(generated.character_id)
  } catch {
    // Manual/uploaded avatars are not necessarily in image_history.
  }
  db.prepare('UPDATE characters SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(filePath, targetId)
  const updated = getCharacterById(targetId)
  if (!updated) throw new Error('Character not found after avatar update.')
  return updated
}`)
  }, true)

  // Adult image/video setting is always ON. Explicit age checks remain.
  mutate('src/main/settings.ts', (src) => {
    let out = src
    out = out.replace(/adult_images_enabled:\s*getBooleanSetting\((['"])adult_images_enabled\1,\s*(?:false|true)\)/g, 'adult_images_enabled: true')
    out = out.replace(/adult_images_enabled:\s*Boolean\([^\n,}]+\)/g, 'adult_images_enabled: true')
    out = out.replace(/setSetting\((['"])adult_images_enabled\1,\s*String\([^\n;]+\)\)/g, "setSetting('adult_images_enabled', 'true')")
    return out
  }, true)
  mutate('src/main/db.ts', (src) => src
    .replace(/seedSetting\((['"])adult_images_enabled\1,\s*(['"])false\2\)/g, "seedSetting('adult_images_enabled', 'true')")
    .replace(/seedSetting\((['"])adult_images_enabled\1,\s*(['"])true\2\)/g, "seedSetting('adult_images_enabled', 'true')"), true)

  for (const rel of ['src/main/mediaPrompt.ts', 'src/main/images.ts', 'src/main/videos.ts']) {
    mutate(rel, (src) => src
      .replace(/\s*if\s*\(\s*!settings\.adult_images_enabled\s*\)\s*\{[\s\S]*?\n\s*\}/g, '')
      .replace(/\s*if\s*\(\s*!getSettings\(\)\.adult_images_enabled\s*\)\s*\{[\s\S]*?\n\s*\}/g, ''), true)
  }

  // Keep adult consensual chat in-character instead of refusing just because it is sexual.
  mutate('src/main/ai.ts', (src) => {
    if (src.includes('Consensual adult intimacy rule:')) return src
    const addition = ' Consensual adult intimacy rule: when every participant is explicitly 18+, consensual sexual/romantic roleplay and explicit language are allowed; do not moralize, euphemize, or refuse merely because adult content is sexual. Stay in character and preserve the current relationship/context. Never sexualize minors, ambiguous-age people, coercion, or non-consensual exploitation.'
    const anchors = [
      'Write like a real private message, direct/relaxed/specific.',
      'Write like a real private message',
      'Avoid overexplaining',
      'Match the user energy'
    ]
    for (const anchor of anchors) {
      if (src.includes(anchor)) return src.replace(anchor, anchor + addition)
    }
    warn('Could not find the v5 chat-style prompt anchor in ai.ts; other v7 changes will still install.')
    return src
  }, true)

  // Delay ComfyUI teardown so the completed image/video file is fetched before Qwen is restarted.
  for (const rel of ['src/main/images.ts', 'src/main/videos.ts']) {
    mutate(rel, (src) => {
      if (src.includes('v7 delayed media cleanup')) return src
      let out = src
      let changed = false
      const patterns = [
        /if\s*\(isManaged\('images'\)\s*&&\s*!settings\.auto_start_comfy\)\s*await\s+stopService\('images'\)\s*\n\s*void\s+startService\('brain'\)/g,
        /if\s*\(isManaged\("images"\)\s*&&\s*!settings\.auto_start_comfy\)\s*await\s+stopService\("images"\)\s*\n\s*void\s+startService\("brain"\)/g
      ]
      for (const pattern of patterns) {
        out = out.replace(pattern, () => {
          changed = true
          return `// v7 delayed media cleanup
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
      return changed ? out : src
    }, true)
  }

  // Install the PC-hosted phone API/media manager.
  copyPatchFile('phoneServer.ts', 'src/main/phoneServer.ts')
  mutate('src/main/index.ts', (src) => {
    if (src.includes("import './phoneServer'")) return src
    const lines = src.split(/\r?\n/)
    let at = 0
    while (at < lines.length && (lines[at].startsWith('import ') || lines[at].trim() === '')) at++
    lines.splice(at, 0, "import './phoneServer'")
    return lines.join('\n')
  })

  // Install a desktop Media Inspector without replacing the existing React UI.
  copyPatchFile('v7Overlay.ts', 'src/renderer/src/v7Overlay.ts')
  mutate('src/renderer/index.html', (src) => {
    if (src.includes('/src/v7Overlay.ts')) return src
    if (!src.includes('</body>')) throw new Error('renderer index.html has no </body> tag')
    return src.replace('</body>', '  <script type="module" src="/src/v7Overlay.ts"></script>\n</body>')
  })

  setPackageVersion('package.json', '7.0.0')
  setPackageVersion('package-lock.json', '7.0.0')

  console.log('\n[v7] Files installed successfully.')
  if (warnings.length) console.log(`[v7] Non-fatal warnings: ${warnings.length}`)
  console.log('[v7] The updater will now run the project TypeScript checks.')
} catch (error) {
  console.error('\n[v7] UPDATE FAILED:', error)
  rollback()
  process.exitCode = 1
}
