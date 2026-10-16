// Pure helpers: parse one progress file and summarise it. No $ here, so tests call them directly.

const STATUSES = ['done', 'running', 'pending', 'failed']
const ALIAS = { ok: 'done', pass: 'done', complete: 'done', completed: 'done', fail: 'failed', error: 'failed' }

// "done: 11402 pass" -> status by its first word (case-insensitive), the rest becomes detail.
function normStatus(raw) {
  const [, word = '', rest = ''] = /^\s*(\S*)\s*(.*)$/s.exec(String(raw ?? '')) ?? []
  const w = word.toLowerCase().replace(/[^a-z]+$/, '')
  return { status: STATUSES.includes(w) ? w : ALIAS[w] ?? 'pending', rest: rest.trim() }
}

function toTask(t) {
  if (typeof t === 'string') {
    const m = /\b(done|running|pending|failed)\b/i.exec(t)
    return { name: t, status: m ? m[1].toLowerCase() : 'pending', detail: '' }
  }
  const { status, rest } = normStatus(t.status)
  const detail = t.detail == null ? '' : String(t.detail)
  return { name: String(t.name ?? '(unnamed)'), status, detail: detail === '' ? rest : detail }
}

export const MARK = {
  done: { glyph: '✓', color: 'success' },
  running: { glyph: '●', color: 'warning' },
  pending: { glyph: '○', color: 'inactive' },
  failed: { glyph: '✗', color: 'error' },
}

/** @returns {import('../types').ProgressFile} */
export function parseProgress(file, text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { file, title: file, updated: '', tasks: [], error: 'invalid JSON' }
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.tasks)) {
    return { file, title: file, updated: '', tasks: [], error: 'no "tasks" array' }
  }
  const tasks = data.tasks
    .filter(t => typeof t === 'string' || (t !== null && typeof t === 'object'))
    .map(toTask)
  // now.action "done" marks the whole file finished, whatever its tasks say; it then has no "now" line.
  const finished = typeof data.now?.action === 'string' && data.now.action.trim().toLowerCase() === 'done'
  const now = !finished && data.now !== null && typeof data.now === 'object' && typeof data.now.action === 'string' && data.now.action !== ''
    ? { action: data.now.action, since: typeof data.now.since === 'string' ? data.now.since : '' }
    : undefined
  return {
    file,
    title: typeof data.title === 'string' && data.title !== '' ? data.title : file,
    updated: typeof data.updated === 'string' ? data.updated : '',
    tasks,
    ...(finished ? { finished } : {}),
    ...(now ? { now } : {}),
  }
}

// "yyyy/MM/dd HH:mm:ss" (local) -> epoch ms, or NaN.
export function parseStamp(s) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s ?? '')
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN
}

// Elapsed between two stamps as "4m 12s" / "1h 03m"; '' when either is unknown.
export function elapsed(since, at) {
  const ms = parseStamp(at) - parseStamp(since)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// Marked done, or every task done: the file collapses to one smiley line.
export const isFinished = f => !f.error && (f.finished === true || (f.tasks.length > 0 && f.tasks.every(t => t.status === 'done')))

export function summary(tasks) {
  const n = s => tasks.filter(t => t.status === s).length
  const extra = [n('running') && `${n('running')} running`, n('failed') && `${n('failed')} failed`].filter(Boolean)
  return `${n('done')}/${tasks.length} done${extra.length ? ' · ' + extra.join(' · ') : ''}`
}

// A dismissal is keyed on file + updated, so a file that changes later shows again.
export const dismissKey = f => `${f.file}|${f.updated}`

// Not dismissed, running first, finished after; each group keeps its newest-first order.
export function visible(list, dismissed) {
  const shown = list.filter(f => !dismissed.includes(dismissKey(f)))
  const done = isFinished
  return [...shown.filter(f => !done(f)), ...shown.filter(done)]
}
