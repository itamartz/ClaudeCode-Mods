import { atom, read, update } from 'claude-code'
import { ANSWERS, MARK, answerKey, answerText, dismissKey, elapsed, isFinished, parseProgress, shownTasks, summary, taskKey, visible } from './progress.js'

// Read-only: the mod lists and reads this one folder, nothing else.
// Set by register from the progressDir option (see plugin.json userConfig).
let DIR = ''
const PANE = 'athena-progress'
const REFRESH_MS = 10000

const files = atom({ plugin: 'athena-progress', key: 'files' }, [])
const readAt = atom({ plugin: 'athena-progress', key: 'readAt' }, '')
// Mirrors $.store 'dismissed' (kept across sessions) so the pane redraws on change.
const dismissed = atom({ plugin: 'athena-progress', key: 'dismissed' }, [])
// Mirrors $.store 'hiddenTasks': done tasks hidden inside running cards, by taskKey.
const hiddenTasks = atom({ plugin: 'athena-progress', key: 'hiddenTasks' }, [])
// Answers given to waiting tasks this session, by answerKey; never written to the progress files.
const answers = atom({ plugin: 'athena-progress', key: 'answers' }, {})

const pad = n => String(n).padStart(2, '0')
const stamp = d => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

async function load($) {
  const entries = await $.fs.list(DIR).catch(() => [])
  const json = entries.filter(e => e.kind === 'file' && e.name.toLowerCase().endsWith('.json'))
  json.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const parsed = await Promise.all(
    json.map(async e => {
      const text = await $.fs.read(`${DIR}\\${e.name}`).catch(() => undefined)
      return text === undefined
        ? { file: e.name, title: e.name, updated: '', tasks: [], error: 'unreadable' }
        : parseProgress(e.name, text)
    }),
  )
  await update($, files, () => parsed)
  const kept = await $.store.get('dismissed')
  await update($, dismissed, () => (Array.isArray(kept) ? kept : []))
  const hid = await $.store.get('hiddenTasks')
  await update($, hiddenTasks, () => (Array.isArray(hid) ? hid : []))
  const now = await $.clock.now()
  await update($, readAt, () => stamp(new Date(now)))
}

const isOpen = async $ => (await $.ui.panes()).some(p => p.id === PANE)

// Dismiss every finished file; returns the reply line.
async function clearFinished($) {
  const keys = (await read($, files)).filter(f => isFinished(f)).map(dismissKey)
  const old = await read($, dismissed)
  const fresh = keys.filter(k => !old.includes(k))
  // Keep only keys that still match a file, so the store never grows unbounded.
  const next = [...old.filter(k => keys.includes(k)), ...fresh]
  await update($, dismissed, () => next)
  await $.store.set('dismissed', next)
  return `Cleared ${fresh.length} finished.`
}

/** @type {import('claude-code').Register} */
export const register = (on, options) => {
  DIR = String(options.progressDir)
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress',
      description: 'Toggle the Athena progress pane (refresh re-reads now, clear hides finished work, clear tasks hides done tasks, show un-hides)',
      argumentHint: '[refresh|clear|clear tasks|clear all|show]',
      immediate: true,
    })
    // Cheap: one directory listing every 20 s, and only while the pane is open.
    // Always re-read on the tick (one listing + one small read per file): gating on
    // $.ui.panes() left the pane frozen when the lookup did not match.
    $.clock.every(REFRESH_MS, async () => {
      try {
        await load($)
      } catch (err) {
        await $.ui.log(`athena-progress: refresh failed: ${err}`, { to: 'debug' })
      }
    })
    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'refresh') {
      await load($)
      return { text: 'Progress re-read.' }
    }
    if (arg === 'show') {
      await update($, dismissed, () => [])
      await update($, hiddenTasks, () => [])
      await $.store.set('dismissed', [])
      await $.store.set('hiddenTasks', [])
      return { text: 'Showing everything.' }
    }
    if (arg === 'clear' || arg === 'clear tasks' || arg === 'clear all') {
      await load($)
      const said = []
      if (arg !== 'clear tasks') said.push(await clearFinished($))
      if (arg !== 'clear') {
        // Every done task in a running card; keys of tasks gone or no longer done drop out.
        const keys = (await read($, files)).filter(f => !f.error && !isFinished(f)).flatMap(f => f.tasks.filter(t => t.status === 'done').map(t => taskKey(f, t)))
        const old = await read($, hiddenTasks)
        await update($, hiddenTasks, () => keys)
        await $.store.set('hiddenTasks', keys)
        said.push(`Hid ${keys.filter(k => !old.includes(k)).length} done tasks.`)
      }
      return { text: said.join(' ') }
    }
    if (await isOpen($)) {
      await $.ui.close({ id: PANE })
      return { text: 'Progress pane closed.' }
    }
    await load($)
    await $.ui.open({ id: PANE, title: 'Progress' })
    return { text: 'Progress pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, files)
    const list = visible(all, await read($, dismissed))
    const at = await read($, readAt)
    const given = await read($, answers)
    const hid = await read($, hiddenTasks)
    if (all.length > 0 && list.length === 0) return h(Text, { dimColor: true }, 'No running work')
    if (list.length === 0) {
      return h(Box, { flexDirection: 'column' },
        h(Text, { dimColor: true }, 'No progress files'),
        h(Text, { dimColor: true, wrap: 'truncate-middle' }, DIR))
    }
    return h(Box, { flexDirection: 'column' },
      ...list.map(f => [f, shownTasks(f, hid)]).map(([f, shown]) => isFinished(f)
        ? h(Text, { key: f.file, color: 'success', wrap: 'truncate-end' },
            `😊 ${f.title} — done · ${f.tasks.length} tasks${f.updated ? ' · updated ' + f.updated.slice(-8) : ''}`)
        : h(Box, { key: f.file, flexDirection: 'column', marginBottom: 1 },
          h(Text, { bold: true, wrap: 'truncate-end' }, f.title),
          f.error
            ? h(Text, { color: 'error' }, `${f.file}: ${f.error}`)
            : h(Text, { dimColor: true }, `${summary(f.tasks, f.tasks.length - shown.length)}${f.updated ? ' · updated ' + f.updated.slice(-8) : ''}${at ? ' · checked ' + at.slice(-8) : ''}`),
          f.now
            ? h(Text, { wrap: 'truncate-end' },
                h(Text, { color: 'warning' }, '▶ '),
                f.now.action,
                h(Text, { dimColor: true }, elapsed(f.now.since, at) ? ` · ${elapsed(f.now.since, at)}` : ''))
            : '',
          ...shown.map(t => t.status === 'waiting'
            ? waitingRow($, { Box, Text, Button }, f, t, given[answerKey(f, t)])
            : h(Text, { wrap: 'truncate-end' },
              h(Text, { color: MARK[t.status].color }, MARK[t.status].glyph),
              ` ${t.name}`,
              t.detail ? h(Text, { dimColor: true }, ` — ${t.detail}`) : ''),
          ),
        ),
      ),
      h(Text, { dimColor: true }, `read ${at}`),
    )
  })
}

// A task waiting on the user: the question highlighted, then Done / In progress / Blocked, or the answer once given.
function waitingRow($, { Box, Text, Button }, f, t, answer) {
  const k = answerKey(f, t)
  return h(Box, { key: k, flexDirection: 'column' },
    h(Text, { bold: true, color: MARK.waiting.color }, `${MARK.waiting.glyph} ${t.name}${t.detail ? ' — ' + t.detail : ''}`),
    answer
      ? h(Text, { color: 'success' }, `  ✓ answered: ${answer}`)
      : h(Box, { flexDirection: 'row', gap: 1, marginLeft: 2 },
        ...ANSWERS.map(a => h(Button, {
          key: `${k}|${a}`,
          label: a,
          ...(a === 'Done' ? { variant: 'primary' } : {}),
          onPress: async () => {
            await update($, answers, m => ({ ...m, [k]: a }))
            // A real user turn: queued by the engine, it starts once the session is idle.
            await $.prompt.submit({ text: answerText(f, t, a), asUser: true })
          },
        }))),
  )
}
