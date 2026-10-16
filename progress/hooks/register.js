import { atom, read, update } from 'claude-code'
import { MARK, dismissKey, elapsed, isFinished, parseProgress, summary, visible } from './progress.js'

// Read-only: the mod lists and reads this one folder, nothing else.
// Set by register from the progressDir option (see plugin.json userConfig).
let DIR = ''
const PANE = 'athena-progress'
const REFRESH_MS = 10000

const files = atom({ plugin: 'athena-progress', key: 'files' }, [])
const readAt = atom({ plugin: 'athena-progress', key: 'readAt' }, '')
// Mirrors $.store 'dismissed' (kept across sessions) so the pane redraws on change.
const dismissed = atom({ plugin: 'athena-progress', key: 'dismissed' }, [])

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
  const now = await $.clock.now()
  await update($, readAt, () => stamp(new Date(now)))
}

const isOpen = async $ => (await $.ui.panes()).some(p => p.id === PANE)

/** @type {import('claude-code').Register} */
export const register = (on, options) => {
  DIR = String(options.progressDir)
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress',
      description: 'Toggle the Athena progress pane (refresh re-reads now, clear hides finished work)',
      argumentHint: '[refresh|clear]',
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
    if (e.args.trim() === 'refresh') {
      await load($)
      return { text: 'Progress re-read.' }
    }
    if (e.args.trim() === 'clear') {
      await load($)
      const keys = (await read($, files)).filter(f => isFinished(f)).map(dismissKey)
      const old = await read($, dismissed)
      const fresh = keys.filter(k => !old.includes(k))
      // Keep only keys that still match a file, so the store never grows unbounded.
      const next = [...old.filter(k => keys.includes(k)), ...fresh]
      await update($, dismissed, () => next)
      await $.store.set('dismissed', next)
      return { text: `Cleared ${fresh.length} finished.` }
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
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, files)
    const list = visible(all, await read($, dismissed))
    const at = await read($, readAt)
    if (all.length > 0 && list.length === 0) return h(Text, { dimColor: true }, 'No running work')
    if (list.length === 0) {
      return h(Box, { flexDirection: 'column' },
        h(Text, { dimColor: true }, 'No progress files'),
        h(Text, { dimColor: true, wrap: 'truncate-middle' }, DIR))
    }
    return h(Box, { flexDirection: 'column' },
      ...list.map(f => isFinished(f)
        ? h(Text, { key: f.file, color: 'success', wrap: 'truncate-end' },
            `😊 ${f.title} — done · ${f.tasks.length} tasks${f.updated ? ' · updated ' + f.updated.slice(-8) : ''}`)
        : h(Box, { key: f.file, flexDirection: 'column', marginBottom: 1 },
          h(Text, { bold: true, wrap: 'truncate-end' }, f.title),
          f.error
            ? h(Text, { color: 'error' }, `${f.file}: ${f.error}`)
            : h(Text, { dimColor: true }, `${summary(f.tasks)}${f.updated ? ' · updated ' + f.updated.slice(-8) : ''}${at ? ' · checked ' + at.slice(-8) : ''}`),
          f.now
            ? h(Text, { wrap: 'truncate-end' },
                h(Text, { color: 'warning' }, '▶ '),
                f.now.action,
                h(Text, { dimColor: true }, elapsed(f.now.since, at) ? ` · ${elapsed(f.now.since, at)}` : ''))
            : '',
          ...f.tasks.map(t =>
            h(Text, { wrap: 'truncate-end' },
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
