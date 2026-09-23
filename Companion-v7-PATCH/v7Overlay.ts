const API = 'http://127.0.0.1:8765'
let panel: HTMLDivElement | null = null
let state: any = null

function esc(value: any): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  } as any)[c])
}
async function api(route: string, payload?: any): Promise<any> {
  const response = await fetch(API + route, payload === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}
function installStyle(): void {
  if (document.getElementById('v7-style')) return
  const style = document.createElement('style')
  style.id = 'v7-style'
  style.textContent = `
#v7btn{position:fixed;right:18px;bottom:88px;z-index:99990;border:1px solid #555;background:#202027;color:#fff;border-radius:999px;padding:10px 14px;font:13px system-ui;box-shadow:0 8px 30px #0008}
#v7panel{position:fixed;inset:5vh 3vw;z-index:99999;background:#121217;color:#eee;border:1px solid #444;border-radius:16px;box-shadow:0 20px 80px #000d;overflow:auto;font:13px system-ui;padding:14px}
#v7panel button,#v7panel input,#v7panel textarea,#v7panel select{font:inherit}
#v7panel button{background:#292933;color:#fff;border:1px solid #444;border-radius:8px;padding:7px 9px;cursor:pointer}
#v7panel .danger{border-color:#733;color:#fbb}
#v7panel .head{display:flex;align-items:center;gap:8px;position:sticky;top:-14px;background:#121217;padding:10px 0;z-index:3}
#v7panel .head h2{flex:1;margin:0}
#v7panel .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
#v7panel .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
#v7panel .card{background:#1b1b22;border:1px solid #30303a;border-radius:12px;padding:8px}
#v7panel img,#v7panel video{width:100%;max-height:360px;object-fit:contain;background:#000;border-radius:8px}
#v7panel pre{white-space:pre-wrap;word-break:break-word;color:#bbb;font:11px ui-monospace,monospace}
#v7panel label{display:block;color:#bbb;margin-top:6px}
#v7panel input,#v7panel textarea,#v7panel select{width:100%;background:#22222a;color:#fff;border:1px solid #444;border-radius:8px;padding:8px}
#v7panel .form{max-width:720px;margin:auto}
#v7panel .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}`
  document.head.appendChild(style)
}
function installButton(): void {
  if (document.getElementById('v7btn')) return
  const button = document.createElement('button')
  button.id = 'v7btn'
  button.textContent = 'Media / Prompt / Delete'
  button.onclick = () => { void openPanel('gallery') }
  document.body.appendChild(button)
}
function closePanel(): void {
  panel?.remove()
  panel = null
}
async function refreshState(): Promise<void> {
  state = await api('/api/state')
}
async function openPanel(tab = 'gallery'): Promise<void> {
  installStyle()
  await refreshState()
  closePanel()
  panel = document.createElement('div')
  panel.id = 'v7panel'
  document.body.appendChild(panel)
  render(tab)
}
function shell(body: string): string {
  return `<div class="head"><h2>Companion v7 • ${esc(state?.active?.name)}</h2><span>18+ mode: ON for adults</span><button id="v7close">Close</button></div><div class="tabs"><button data-tab="gallery">Gallery + prompt/seed</button><button data-tab="generate">Generate photo</button><button data-tab="avatar">Create avatar</button><button data-tab="chat">Chat delete</button><button data-tab="characters">Characters</button></div>${body}`
}
function wireTabs(): void {
  const close = document.getElementById('v7close')
  if (close) close.onclick = closePanel
  panel?.querySelectorAll('[data-tab]').forEach((node: Element) => {
    const button = node as HTMLButtonElement
    button.onclick = () => render(button.dataset.tab || 'gallery')
  })
}
function render(tab: string): void {
  if (!panel) return
  if (tab === 'gallery') renderGallery()
  else if (tab === 'generate') renderForm(false)
  else if (tab === 'avatar') renderForm(true)
  else if (tab === 'chat') renderChat()
  else renderCharacters()
}
function mediaType(item: any): 'image' | 'video' {
  const value = String(item.image_type || item.media_type || item.kind || '').toLowerCase()
  return value.includes('video') ? 'video' : 'image'
}
function renderGallery(): void {
  if (!panel) return
  const cards = (state.gallery || []).map((item: any) => {
    const url = API + item.media_url
    const meta = item.metadata || {}
    const details = `REQUEST:\n${item.request_prompt || ''}\n\nFINAL PROMPT:\n${item.prompt || ''}\n\nSEED: ${item.seed ?? 'unknown'}\n\nSETTINGS:\n${JSON.stringify(meta.v7_options || meta, null, 2)}`
    const media = mediaType(item) === 'video'
      ? `<video src="${url}" controls></video>`
      : `<img src="${url}">`
    return `<div class="card">${media}<b>${esc(item.image_type || 'image')}</b><pre>${esc(details)}</pre><button data-reuse="${item.id}">Reuse prompt + seed</button> <button class="danger" data-delmedia="${item.id}">Delete</button></div>`
  }).join('')
  panel.innerHTML = shell(`<div class="grid">${cards || '<p>No generated media yet.</p>'}</div>`)
  wireTabs()
  panel.querySelectorAll('[data-delmedia]').forEach((node: Element) => {
    const button = node as HTMLButtonElement
    button.onclick = async () => {
      if (!confirm('Delete this generated image/video?')) return
      await api('/api/delete-media', { id: Number(button.dataset.delmedia) })
      await openPanel('gallery')
    }
  })
  panel.querySelectorAll('[data-reuse]').forEach((node: Element) => {
    const button = node as HTMLButtonElement
    button.onclick = () => {
      const item = state.gallery.find((x: any) => x.id === Number(button.dataset.reuse))
      renderForm(false, item)
    }
  })
}
function renderForm(avatar: boolean, reuse?: any): void {
  if (!panel) return
  const prompt = reuse?.request_prompt || reuse?.prompt || (avatar
    ? 'photorealistic attractive profile portrait, natural skin texture, same exact woman'
    : 'a natural candid photo right now')
  panel.innerHTML = shell(`<div class="form"><label>Prompt</label><textarea id="v7prompt" rows="5">${esc(prompt)}</textarea><div class="two"><div><label>Seed (blank = random)</label><input id="v7seed" value="${esc(reuse?.seed ?? '')}"></div><div><label>Quality</label><select id="v7quality"><option>hd</option><option>fast</option></select></div><div><label>Mode</label><select id="v7mode"><option>candid</option><option>selfie</option><option ${avatar ? 'selected' : ''}>portrait</option><option>scene</option></select></div><div><label>Steps</label><input id="v7steps" placeholder="auto"></div><div><label>Width</label><input id="v7width" value="768"></div><div><label>Height</label><input id="v7height" value="1024"></div></div><label>Negative prompt</label><textarea id="v7neg" rows="2"></textarea><label><input id="v7ref" type="checkbox" checked style="width:auto"> use character reference</label><label><input id="v7loc" type="checkbox" ${avatar ? '' : 'checked'} style="width:auto"> use current location</label><label><input id="v7clothes" type="checkbox" ${avatar ? '' : 'checked'} style="width:auto"> use current outfit</label><label><input id="v7act" type="checkbox" ${avatar ? '' : 'checked'} style="width:auto"> use current activity</label><button id="v7go">${avatar ? 'Generate + set avatar' : 'Generate photo'}</button></div>`)
  wireTabs()
  const go = document.getElementById('v7go') as HTMLButtonElement | null
  if (!go) return
  go.onclick = async () => {
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value
    const checked = (id: string) => (document.getElementById(id) as HTMLInputElement).checked
    const payload = {
      prompt: value('v7prompt'),
      seed: value('v7seed') ? Number(value('v7seed')) : undefined,
      quality: value('v7quality'),
      mode: value('v7mode'),
      steps: value('v7steps') ? Number(value('v7steps')) : undefined,
      width: Number(value('v7width')),
      height: Number(value('v7height')),
      negativePrompt: value('v7neg'),
      useReference: checked('v7ref'),
      useCurrentLocation: checked('v7loc'),
      useCurrentClothing: checked('v7clothes'),
      useCurrentActivity: checked('v7act')
    }
    go.disabled = true
    go.textContent = 'Generating…'
    try {
      await api(avatar ? '/api/avatar' : '/api/photo', payload)
      await openPanel('gallery')
    } catch (error: any) {
      alert(error?.message || String(error))
      render(avatar ? 'avatar' : 'generate')
    }
  }
}
function renderChat(): void {
  if (!panel) return
  const rows = (state.messages || []).map((m: any) => `<div class="card"><b>${esc(m.sender)} • ${esc(m.created_at || '')}</b><div>${esc(m.content)}</div><button class="danger" data-delmsg="${m.id}">Delete message</button></div>`).join('')
  panel.innerHTML = shell(`<p><button id="v7clear" class="danger">Delete ALL chat history for ${esc(state.active.name)}</button></p><div class="grid">${rows || '<p>No messages.</p>'}</div>`)
  wireTabs()
  const clear = document.getElementById('v7clear')
  if (clear) clear.onclick = async () => {
    if (!confirm('Delete all chat history for this character?')) return
    await api('/api/clear-history', {})
    await openPanel('chat')
  }
  panel.querySelectorAll('[data-delmsg]').forEach((node: Element) => {
    const button = node as HTMLButtonElement
    button.onclick = async () => {
      if (!confirm('Delete this message?')) return
      await api('/api/delete-message', { id: Number(button.dataset.delmsg) })
      await openPanel('chat')
    }
  })
}
function renderCharacters(): void {
  if (!panel) return
  const rows = (state.characters || []).map((c: any) => `<div class="card"><b>${esc(c.name)}</b><div>Age: ${esc(c.age ?? 'not set')}</div><button class="danger" data-delchar="${c.id}" ${c.id === state.active.id ? 'disabled title="Switch away first"' : ''}>Delete character</button></div>`).join('')
  panel.innerHTML = shell(`<div class="grid">${rows}</div>`)
  wireTabs()
  panel.querySelectorAll('[data-delchar]').forEach((node: Element) => {
    const button = node as HTMLButtonElement
    button.onclick = async () => {
      if (!confirm('Delete this character and its local data?')) return
      await api('/api/delete-character', { id: Number(button.dataset.delchar) })
      await openPanel('characters')
    }
  })
}

installStyle()
installButton()
setInterval(installButton, 1500)
export {}
