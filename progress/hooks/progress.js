// Pure helpers: parse one progress file and summarise it. No $ here, so tests call them directly.

const STATUSES = ['done', 'running', 'pending', 'failed', 'waiting']
const ALIAS = { ok: 'done', pass: 'done', complete: 'done', completed: 'done', fail: 'failed', error: 'failed', wait: 'waiting', 'blocked-on-user': 'waiting' }

// "done: 11402 pass" -> status by its first word (case-insensitive), the rest becomes detail.
function normStatus(raw) {
  const [, word = '', rest = ''] = /^\s*(\S*)\s*(.*)$/s.exec(String(raw ?? '')) ?? []
  const w = word.toLowerCase().replace(/[^a-z]+$/, '')
  return { status: STATUSES.includes(w) ? w : ALIAS[w] ?? 'pending', rest: rest.trim() }
}

function toTask(t) {
  if (typeof t === 'string') {
    const m = /\b(done|running|pending|failed|waiting)\b/i.exec(t)
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
  waiting: { glyph: '🙋', color: 'permission' },
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

export const isWaiting = f => f.tasks.some(t => t.status === 'waiting')

// Marked done, or every task done (and none waiting on the user): the file collapses to one smiley line.
export const isFinished = f => !f.error && !isWaiting(f) && (f.finished === true || (f.tasks.length > 0 && f.tasks.every(t => t.status === 'done')))

// Footer counts: cards not finished and not invalid, and their tasks not done.
export function openCounts(files) {
  const open = files.filter(f => !f.error && !isFinished(f))
  return { cards: open.length, tasks: open.reduce((n, f) => n + f.tasks.filter(t => t.status !== 'done').length, 0) }
}

export function summary(tasks, hidden = 0) {
  const n = s => tasks.filter(t => t.status === s).length
  const extra = [n('waiting') && `${n('waiting')} waiting`, n('running') && `${n('running')} running`, n('failed') && `${n('failed')} failed`, hidden && `${hidden} hidden`].filter(Boolean)
  return `${n('done')}/${tasks.length} done${extra.length ? ' · ' + extra.join(' · ') : ''}`
}

// A dismissal is keyed on file + updated, so a file that changes later shows again.
export const dismissKey = f => `${f.file}|${f.updated}`

// A task hidden by "clear tasks" is keyed on file + task name, so it stays hidden while the file changes.
export const taskKey = (f, t) => `${f.file}|${t.name}`

// Only done tasks are ever hidden, whatever keys are stored.
export const shownTasks = (f, hidden) => f.tasks.filter(t => t.status !== 'done' || !hidden.includes(taskKey(f, t)))

// An answer to a waiting task is keyed like a dismissal, so it lapses when the file changes.
export const answerKey = (f, t) => `${dismissKey(f)}|${t.name}`

// The user message a button press sends into the session.
export const answerText = (f, t, answer) => `[progress] ${f.title} › ${t.name}: ${answer}`

export const ANSWERS = ['Done', 'In progress', 'Blocked']

// Not dismissed; waiting on the user first, then running, finished last; each group keeps its newest-first order.
export function visible(list, dismissed) {
  const shown = list.filter(f => !dismissed.includes(dismissKey(f)))
  const done = isFinished
  return [...shown.filter(isWaiting), ...shown.filter(f => !isWaiting(f) && !done(f)), ...shown.filter(done)]
}
