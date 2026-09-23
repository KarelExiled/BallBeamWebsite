import { app } from 'electron'
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

function db(): any {
  const fn = (dbMod as any).getDatabase
  if (typeof fn !== 'function') throw new Error('Database module unavailable.')
  return fn()
}
function getSetting(key: string): any {
  const fn = (dbMod as any).getSetting
  return typeof fn === 'function' ? fn(key) : null
}
function setSetting(key: string, value: string): void {
  const fn = (dbMod as any).setSetting
  if (typeof fn === 'function') fn(key, value)
}
function active(): any {
  const fn = (characterMod as any).getActiveCharacter
  if (typeof fn !== 'function') throw new Error('Character module unavailable.')
  return fn()
}
function chars(): any[] {
  const fn = (characterMod as any).listCharacters
  return typeof fn === 'function' ? fn() || [] : []
}
function settings(): any {
  const fn = (settingsMod as any).getSettings
  return typeof fn === 'function' ? fn() || {} : {}
}

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
function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || 'unknown'
}
function allowed(req: IncomingMessage, payload?: any): boolean {
  if (loopback(req)) return true
  const key = clientIp(req)
  const fail = failedAuth.get(key)
  if (fail && fail.until > Date.now()) return false
  const url = new URL(req.url || '/', 'http://localhost')
  const ok = url.searchParams.get('pin') === token() || String(payload?.pin || '') === token()
  if (ok) {
    failedAuth.delete(key)
    return true
  }
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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}
async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function parseMeta(value: any): any {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
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
      return {
        ...row,
        file_path: undefined,
        metadata: meta,
        prompt,
        request_prompt: meta.request_prompt || meta.user_prompt || row.request_prompt || prompt,
        seed: firstNumber(row.seed, meta.seed, meta.noise_seed, meta.random_seed),
        media_url: `/media/gallery/${row.id}`
      }
    })
  } catch {
    return []
  }
}
function messages(characterId: number): any[] {
  try {
    const fn = (chatMod as any).getChatHistory
    const rows = typeof fn === 'function'
      ? fn()
      : db().prepare('SELECT * FROM messages WHERE character_id = ? ORDER BY id ASC').all(characterId)
    return (rows || []).map((m: any) => ({ ...m, image_url: m.image_path ? `/media/chat/${m.id}` : null }))
  } catch {
    return []
  }
}
function sessions(characterId: number): any[] {
  try {
    const fn = (chatMod as any).listChatSessions
    if (typeof fn === 'function') return fn() || []
    return db().prepare('SELECT * FROM chat_sessions WHERE character_id = ? ORDER BY updated_at DESC, id DESC').all(characterId) as any[]
  } catch {
    return []
  }
}
function state(): any {
  const a = active()
  return {
    active: a,
    characters: chars(),
    sessions: sessions(a.id),
    messages: messages(a.id),
    gallery: gallery(a.id),
    adult_mode: true
  }
}
function randomSeed(): number {
  return randomInt(1, 2_147_483_000)
}
function requestedAdult(text: string): boolean {
  return /\b(nsfw|nude|naked|topless|lingerie|erotic|explicit|sexual|sex|breast|nipple|genital|penis|vagina|pussy|blowjob|masturbat|orgasm|cum|cock|dick)\b/i.test(text)
}
function assertAdultCharacter(character: any): void {
  const age = Number(character?.age)
  if (!Number.isFinite(age) || age < 18) {
    throw new Error('Adult content requires a character with an explicit age of 18+.')
  }
}
function mediaPathFromResult(result: any): string {
  const value = result?.file_path || result?.filePath || result?.path || result?.filename
  if (!value) throw new Error('Generation completed but no output media path was returned.')
  return String(value)
}
function latestGalleryRow(filePath: string): any {
  try {
    return db().prepare('SELECT * FROM image_history WHERE file_path = ? ORDER BY id DESC LIMIT 1').get(filePath)
  } catch {
    return null
  }
}
function enrich(filePath: string, requestedPrompt: string, seed: number, options: any): void {
  try {
    const row = latestGalleryRow(filePath)
    if (!row) return
    const meta = {
      ...parseMeta(row.metadata_json),
      request_prompt: requestedPrompt,
      seed,
      v7_options: options,
      generated_at: new Date().toISOString()
    }
    db().prepare('UPDATE image_history SET metadata_json = ? WHERE id = ?').run(JSON.stringify(meta), row.id)
  } catch (error) {
    console.warn('[v7] Could not enrich media metadata:', error)
  }
}

async function makePhoto(request: any, avatar = false): Promise<any> {
  const characterAtStart = active()
  const prompt = String(request.prompt || (avatar ? 'photorealistic profile portrait, same exact woman' : 'a natural candid photo right now'))
  if (requestedAdult(prompt)) assertAdultCharacter(characterAtStart)

  const seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : randomSeed()
  const width = Math.max(512, Math.min(1536, Number(request.width) || 768))
  const height = Math.max(512, Math.min(1536, Number(request.height) || 1024))
  const quality = String(request.quality || settings().image_quality || 'hd')
  const mode = String(request.mode || (avatar ? 'portrait' : 'candid'))
  const options = {
    seed,
    randomSeed: false,
    useCurrentLocation: Boolean(request.useCurrentLocation ?? !avatar),
    useCurrentClothing: Boolean(request.useCurrentClothing ?? !avatar),
    useCurrentActivity: Boolean(request.useCurrentActivity ?? !avatar),
    useReference: Boolean(request.useReference ?? true),
    negativePrompt: String(request.negativePrompt || ''),
    steps: request.steps == null || request.steps === '' ? undefined : Number(request.steps),
    cfg: request.cfg == null || request.cfg === '' ? undefined : Number(request.cfg)
  }

  const fn: any = (imageMod as any).generateCompanionImageManaged
  if (typeof fn !== 'function') throw new Error('Image generator is unavailable.')
  const result = await fn(prompt, mode, width, height, quality, undefined, options)
  const filePath = mediaPathFromResult(result)
  enrich(filePath, prompt, seed, options)

  if (avatar) {
    db().prepare('UPDATE characters SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(filePath, characterAtStart.id)
  } else {
    const attach: any = (chatMod as any).attachImageMessage
    if (typeof attach === 'function') attach('📷', filePath, 'image')
  }

  return { filePath, seed, character_id: characterAtStart.id }
}

async function makeVideo(request: any): Promise<any> {
  const characterAtStart = active()
  const prompt = String(request.prompt || 'a short natural video right now')
  if (requestedAdult(prompt)) assertAdultCharacter(characterAtStart)
  const seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : randomSeed()
  const options = {
    seed,
    randomSeed: false,
    frames: request.frames == null || request.frames === '' ? undefined : Number(request.frames),
    fps: request.fps == null || request.fps === '' ? undefined : Number(request.fps),
    motion: request.motion == null || request.motion === '' ? undefined : Number(request.motion),
    useReference: Boolean(request.useReference ?? true),
    negativePrompt: String(request.negativePrompt || '')
  }
  const fn: any = (videoMod as any).generateCompanionVideoManaged
  if (typeof fn !== 'function') throw new Error('Video generator is unavailable.')
  const result = await fn(prompt, options)
  const filePath = mediaPathFromResult(result)
  enrich(filePath, prompt, seed, options)
  const attach: any = (chatMod as any).attachImageMessage
  if (typeof attach === 'function') attach('🎬', filePath, 'video')
  return { filePath, seed, character_id: characterAtStart.id }
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
  if (filePath && safeGeneratedPath(filePath)) {
    try { if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true }) } catch {}
  }
}
function deleteMessage(id: number): void {
  try { db().prepare('DELETE FROM messages WHERE id = ?').run(id) } catch {}
}
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
  if (typeof fn === 'function') {
    fn(id)
    return
  }
  const row = db().prepare('SELECT COUNT(*) AS n FROM characters').get() as any
  if (Number(row?.n || 0) <= 1) throw new Error('Keep at least one character.')
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
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const stat = fs.statSync(filePath)
  const range = req.headers.range
  cors(res)
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range)
    if (match) {
      const start = Number(match[1])
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
      res.writeHead(206, {
        'Content-Type': mime(filePath),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, {
    'Content-Type': mime(filePath),
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600'
  })
  fs.createReadStream(filePath).pipe(res)
}

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Companion</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#eee;background:#0e0e12}*{box-sizing:border-box}body{margin:0;background:#0e0e12;color:#eee}button,input,select,textarea{font:inherit}button{cursor:pointer;background:#292933;color:#fff;border:1px solid #3b3b47;border-radius:10px;padding:9px 11px}.top{position:sticky;top:0;z-index:5;background:#18181f;border-bottom:1px solid #2c2c36;padding:10px;display:flex;gap:8px;align-items:center}.top select{flex:1;background:#222;color:#fff;border:1px solid #444;border-radius:9px;padding:8px}.status{padding:7px 12px;font-size:12px;color:#aaa;border-bottom:1px solid #24242c}.messages{padding:12px 12px 100px;display:flex;flex-direction:column;gap:10px}.msg{max-width:90%;padding:10px 12px;border-radius:15px;background:#22222b}.me{align-self:flex-end;background:#35304b}.meta{font-size:11px;color:#9a9aa6;margin-bottom:4px}.msg img,.msg video{width:100%;max-height:520px;object-fit:contain;border-radius:10px;margin-top:7px}.composer{position:fixed;bottom:0;left:0;right:0;background:#17171d;border-top:1px solid #292933;padding:9px;display:flex;gap:7px}.composer textarea{flex:1;resize:none;max-height:120px;border:1px solid #373743;border-radius:12px;background:#22222a;color:#fff;padding:10px}.actions{display:flex;gap:6px;overflow:auto;padding:7px 10px;background:#15151b}.gallery{padding:10px;display:grid;grid-template-columns:1fr;gap:10px}.card{background:#191920;border:1px solid #292933;border-radius:12px;padding:8px}.card img,.card video{width:100%;border-radius:9px;background:#000;max-height:560px;object-fit:contain}.details{font-size:12px;color:#bbb;white-space:pre-wrap;word-break:break-word;padding:6px 2px}.danger{border-color:#6f3030!important;color:#ffb0b0!important}.hidden{display:none!important}.login{max-width:360px;margin:18vh auto;padding:20px}.login input,.modal input,.modal textarea,.modal select{width:100%;padding:10px;background:#222;color:#fff;border:1px solid #444;border-radius:9px;margin:4px 0 9px}.modal{position:fixed;inset:0;background:#000b;z-index:20;display:flex;align-items:center;justify-content:center;padding:12px}.modalbox{width:min(620px,100%);max-height:92vh;overflow:auto;background:#17171d;border:1px solid #333;border-radius:14px;padding:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}@media(min-width:800px){.messages,.actions,.top,.status,.composer{max-width:780px;margin-left:auto;margin-right:auto}.composer{left:50%;transform:translateX(-50%);width:780px}.gallery{max-width:900px;margin:auto;grid-template-columns:repeat(2,1fr)}}
</style></head><body><div id="login" class="login hidden"><h2>Companion phone access</h2><p>Enter the 8-digit code shown by Companion on your PC.</p><input id="pinInput" inputmode="numeric" maxlength="8"><button onclick="savePin()">Connect</button></div><div id="app"><div class="top"><select id="character" onchange="switchCharacter()"></select><button onclick="newChat()">New chat</button><button onclick="toggleGallery()">Gallery</button></div><div id="status" class="status"></div><div class="actions"><button onclick="openPhoto(false)">📷 Photo</button><button onclick="openVideo()">🎬 Video</button><button onclick="openPhoto(true)">👤 Avatar</button><button onclick="pickHistory()">History</button><button onclick="clearHistory()" class="danger">Clear chat</button><button onclick="refresh()">↻</button></div><div id="messages" class="messages"></div><div id="gallery" class="gallery hidden"></div><div class="composer"><textarea id="text" rows="1" placeholder="Message…"></textarea><button onclick="send()">Send</button></div></div><div id="modal" class="modal hidden"><div class="modalbox"><h3 id="modalTitle">Generate</h3><label>Prompt</label><textarea id="pPrompt" rows="4"></textarea><div class="grid"><div><label>Seed (blank = random)</label><input id="pSeed" inputmode="numeric"></div><div><label>Quality</label><select id="pQuality"><option>hd</option><option>fast</option></select></div><div><label>Width</label><input id="pWidth" value="768"></div><div><label>Height</label><input id="pHeight" value="1024"></div><div><label>Mode</label><select id="pMode"><option>candid</option><option>selfie</option><option>portrait</option><option>scene</option></select></div><div><label>Steps</label><input id="pSteps" placeholder="auto"></div></div><label>Negative prompt</label><textarea id="pNeg" rows="2"></textarea><label><input id="pLoc" type="checkbox" checked> use current location</label> <label><input id="pClothes" type="checkbox" checked> use current outfit</label> <label><input id="pActivity" type="checkbox" checked> use current activity</label><br><label><input id="pRef" type="checkbox" checked> character reference</label><div style="display:flex;gap:8px;margin-top:12px"><button onclick="runGenerate()">Generate</button><button onclick="closeModal()">Cancel</button></div></div></div><script>
let pin=new URLSearchParams(location.search).get('pin')||localStorage.getItem('companionPin')||'';let S=null;let galleryOpen=false;let genKind='photo';const $=id=>document.getElementById(id);const q=u=>u+(u.includes('?')?'&':'?')+'pin='+encodeURIComponent(pin);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function savePin(){pin=$('pinInput').value.trim();localStorage.setItem('companionPin',pin);$('login').classList.add('hidden');$('app').classList.remove('hidden');refresh()}async function api(url,opt={}){const r=await fetch(q(url),{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});if(r.status===401){$('login').classList.remove('hidden');$('app').classList.add('hidden');throw Error('PIN required')}if(!r.ok)throw Error(await r.text());return r.json()}async function post(url,obj={}){return api(url,{method:'POST',body:JSON.stringify({...obj,pin})})}function fmt(t){try{return new Date(t).toLocaleString()}catch{return t||''}}function mediaType(g){return String(g.image_type||g.media_type||g.kind||'').toLowerCase().includes('video')||/\.(mp4|webm|mov)$/i.test(String(g.filename||''))?'video':'image'}function render(){if(!S)return;$('character').innerHTML=S.characters.map(c=>'<option value="'+c.id+'" '+(c.id===S.active.id?'selected':'')+'>'+esc(c.name)+'</option>').join('');$('status').textContent=[S.active.name,S.active.current_location||S.active.location,S.active.current_activity,'18+ mode ON for adults'].filter(Boolean).join(' • ');$('messages').innerHTML=S.messages.map(m=>'<div class="msg '+(m.sender==='user'?'me':'')+'"><div class="meta">'+esc(m.sender==='user'?'You':S.active.name)+' • '+esc(fmt(m.created_at))+'</div><div>'+esc(m.content)+'</div>'+(m.image_url?'<img src="'+q(m.image_url)+'">':'')+'<div style="margin-top:6px"><button class="danger" onclick="delMsg('+m.id+')">Delete</button></div></div>').join('');$('gallery').innerHTML=S.gallery.map(g=>{const u=q(g.media_url),t=mediaType(g),meta=g.metadata||{};const details='Request: '+(g.request_prompt||'')+'\nFinal prompt: '+(g.prompt||'')+'\nSeed: '+(g.seed??'unknown')+'\nSettings: '+JSON.stringify(meta.v7_options||meta,null,2);return '<div class="card">'+(t==='video'?'<video src="'+u+'" controls playsinline></video>':'<img src="'+u+'" loading="lazy">')+'<div class="details">'+esc(details)+'</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button onclick="reuse('+g.id+')">Reuse prompt/seed</button><button class="danger" onclick="delMedia('+g.id+')">Delete</button></div></div>'}).join('');requestAnimationFrame(()=>scrollTo(0,document.body.scrollHeight))}async function refresh(){try{S=await api('/api/state');render()}catch(e){console.error(e)}}async function switchCharacter(){await post('/api/switch-character',{id:Number($('character').value)});refresh()}async function send(){const el=$('text'),text=el.value.trim();if(!text)return;el.value='';await post('/api/send',{text});refresh()}async function newChat(){await post('/api/new-chat',{});refresh()}function toggleGallery(){galleryOpen=!galleryOpen;$('gallery').classList.toggle('hidden',!galleryOpen);$('messages').classList.toggle('hidden',galleryOpen)}function openPhoto(avatar){genKind=avatar?'avatar':'photo';$('modalTitle').textContent=avatar?'Create avatar':'Create photo';$('pPrompt').value=avatar?'photorealistic attractive profile portrait, natural skin texture, same exact woman':'a natural candid photo right now';$('pMode').value=avatar?'portrait':'candid';$('pLoc').checked=!avatar;$('pClothes').checked=!avatar;$('pActivity').checked=!avatar;$('modal').classList.remove('hidden')}function openVideo(){genKind='video';$('modalTitle').textContent='Create video';$('pPrompt').value='a short natural video right now';$('modal').classList.remove('hidden')}function closeModal(){$('modal').classList.add('hidden')}async function runGenerate(){const data={prompt:$('pPrompt').value,seed:$('pSeed').value?Number($('pSeed').value):undefined,quality:$('pQuality').value,width:Number($('pWidth').value),height:Number($('pHeight').value),mode:$('pMode').value,steps:$('pSteps').value?Number($('pSteps').value):undefined,negativePrompt:$('pNeg').value,useCurrentLocation:$('pLoc').checked,useCurrentClothing:$('pClothes').checked,useCurrentActivity:$('pActivity').checked,useReference:$('pRef').checked};closeModal();await post(genKind==='avatar'?'/api/avatar':genKind==='video'?'/api/video':'/api/photo',data);refresh()}async function delMedia(id){if(confirm('Delete this generated media?')){await post('/api/delete-media',{id});refresh()}}async function delMsg(id){if(confirm('Delete this message?')){await post('/api/delete-message',{id});refresh()}}async function clearHistory(){if(confirm('Delete all chat history for this character?')){await post('/api/clear-history',{});refresh()}}function reuse(id){const g=S.gallery.find(x=>x.id===id);if(!g)return;openPhoto(false);genKind=mediaType(g)==='video'?'video':'photo';$('modalTitle').textContent='Reuse prompt / seed';$('pPrompt').value=g.request_prompt||g.prompt||'';$('pSeed').value=g.seed??''}async function pickHistory(){if(!S?.sessions?.length)return alert('No history yet');const list=S.sessions.map(x=>x.id+': '+(x.title||x.updated_at||x.created_at)).join('\n');const id=Number(prompt('Chat history – enter ID:\n'+list,''));if(id){await post('/api/switch-chat',{id});refresh()}}$('text').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});if(!pin){$('login').classList.remove('hidden');$('app').classList.add('hidden')}else{localStorage.setItem('companionPin',pin);refresh();setInterval(refresh,2500)}
</script></body></html>`

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    res.end()
    return
  }
  const url = new URL(req.url || '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/') {
    cors(res)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page)
    return
  }
  let payload: any = {}
  if (req.method === 'POST') {
    try { payload = await readBody(req) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
  }
  if (!allowed(req, payload)) {
    json(res, 401, { error: 'PIN required or temporarily locked after too many attempts' })
    return
  }
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') { json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/switch-character') {
      const fn: any = (characterMod as any).setActiveCharacter
      if (typeof fn === 'function') fn(Number(payload.id))
      json(res, 200, state())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const fn: any = (chatMod as any).sendChatMessage
      if (typeof fn !== 'function') throw new Error('Chat send function unavailable.')
      await fn(String(payload.text || ''))
      json(res, 200, state())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/new-chat') {
      const fn: any = (chatMod as any).startNewChat
      if (typeof fn === 'function') await fn()
      json(res, 200, state())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/switch-chat') {
      const fn: any = (chatMod as any).switchChatSession
      if (typeof fn === 'function') await fn(Number(payload.id))
      json(res, 200, state())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/photo') {
      const out = await makePhoto(payload, false)
      json(res, 200, { ...out, state: state() })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/avatar') {
      const out = await makePhoto(payload, true)
      json(res, 200, { ...out, state: state() })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/video') {
      const out = await makeVideo(payload)
      json(res, 200, { ...out, state: state() })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/delete-media') { deleteMedia(Number(payload.id)); json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-message') { deleteMessage(Number(payload.id)); json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-session') { deleteSession(Number(payload.id)); json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/clear-history') { clearCharacterHistory(active().id); json(res, 200, state()); return }
    if (req.method === 'POST' && url.pathname === '/api/delete-character') { deleteCharacter(Number(payload.id)); json(res, 200, state()); return }

    const gm = /^\/media\/gallery\/(\d+)$/.exec(url.pathname)
    if (req.method === 'GET' && gm) {
      const row = db().prepare('SELECT file_path FROM image_history WHERE id = ?').get(Number(gm[1])) as any
      if (!row?.file_path) { res.writeHead(404); res.end('Not found'); return }
      stream(req, res, row.file_path)
      return
    }
    const cm = /^\/media\/chat\/(\d+)$/.exec(url.pathname)
    if (req.method === 'GET' && cm) {
      const row = db().prepare('SELECT image_path FROM messages WHERE id = ?').get(Number(cm[1])) as any
      if (!row?.image_path) { res.writeHead(404); res.end('Not found'); return }
      stream(req, res, row.image_path)
      return
    }
    json(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error('[phone/v7]', error)
    json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function urls(code: string): string[] {
  const result: string[] = []
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const n of rows || []) {
      if (n.family === 'IPv4' && !n.internal) result.push(`http://${n.address}:${PORT}/?pin=${code}`)
    }
  }
  return [...new Set(result)]
}
export function startPhoneServer(): void {
  if (started) return
  started = true
  const code = token()
  const server = http.createServer((req, res) => { void handler(req, res) })
  server.on('error', (error) => console.error('[phone/v7] server error:', error))
  server.listen(PORT, '0.0.0.0', () => {
    const list = urls(code)
    const text = [
      'COMPANION PHONE ACCESS',
      '',
      'Keep Companion running on this PC.',
      'Use a URL below on your phone while on the same Wi-Fi or Tailscale.',
      'Do NOT port-forward port 8765 to the public internet.',
      '',
      ...list,
      '',
      `ACCESS CODE: ${code}`,
      '',
      'Everything (Qwen, ComfyUI, database, chats, images and videos) stays on this PC.'
    ].join('\r\n')
    try { fs.writeFileSync(path.join(process.cwd(), 'PHONE_ACCESS.txt'), text, 'utf8') } catch {}
    console.log('[phone/v7] ' + (list[0] || `http://127.0.0.1:${PORT}`))
  })
}

if (app.isReady()) startPhoneServer()
else void app.whenReady().then(() => startPhoneServer())
