import { expect, mock, test } from 'claude-code/testing'
import { elapsed, isFinished, parseProgress, summary } from '../hooks/progress.js'

const BIOS = JSON.stringify({
  title: 'BIOS phase 2',
  updated: '2026/10/15 20:00:00',
  tasks: [
    { name: 'Catalog', status: 'done', detail: '42 attributes' },
    { name: 'Agent apply', status: 'running', detail: 'PC-5' },
    { name: 'E2E', status: 'pending', detail: '' },
    { name: 'Licence', status: 'failed', detail: 'cert stale' },
  ],
})

const PANE = {
  plugin: 'athena-progress',
  component: 'Pane',
  requestId: 'athena-progress',
  viewport: { columns: 120, rows: 30 },
  props: {
    title: 'Progress',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Flattens a drawn tree into its lines of text, for asserting and previewing.
const lines = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  const el = node as { type: string; children: unknown[] }
  const parts = el.children.map(lines)
  return el.type === 'Text' ? [parts.flat().join('')] : parts.flat()
}

// Stubs the world the mod reads: a folder of files, the pane list, the clock.
function world(on: Parameters<Parameters<typeof test>[1]>[1], folder: Record<string, string> | null, stored?: Record<string, unknown>) {
  const state = { open: false, lists: 0, paths: [] as string[] }
  const clock = mock.clock(on, { now: new Date(2026, 9, 15, 20, 5, 0).getTime() })
  mock.store(on, stored)
  on('fs.list', ($, e) => {
    state.lists++
    state.paths.push(e.path)
    if (folder === null) return { deny: 'ENOENT' }
    return { value: Object.keys(folder).map((name, i) => ({ name, kind: 'file', size: 1, mtimeMs: 100 - i, isLink: false })) }
  })
  on('fs.read', ($, e) => {
    state.paths.push(e.path)
    const name = Object.keys(folder ?? {}).find(n => e.path.endsWith('\\' + n))
    return name === undefined ? { deny: 'ENOENT' } : { value: folder![name] }
  })
  on('ui.panes', () => ({ value: state.open ? [{ id: 'athena-progress', title: 'Progress', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.open', () => { state.open = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { state.open = false; return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  return Object.assign(state, { clock })
}

test('parse: statuses, defaults, invalid JSON', () => {
  const ok = parseProgress('a.json', BIOS)
  expect(ok.title).toBe('BIOS phase 2')
  expect(summary(ok.tasks)).toBe('1/4 done · 1 running · 1 failed')
  expect(parseProgress('x.json', '{oops').error).toBe('invalid JSON')
  expect(parseProgress('y.json', '{"title":"t"}').error).toBe('no "tasks" array')
  expect(parseProgress('z.json', '{"tasks":[{"name":"n","status":"weird"}]}').tasks[0].status).toBe('pending')
})

test('/progress opens the pane and draws each file and task', async ($, on) => {
  world(on, { 'bios-phase2.json': BIOS, 'broken.json': '{nope' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const answer = await $.command.run({ command: 'progress', args: '' })
    if (surface === 'terminal') expect(answer.text).toBe('Progress pane opened.')
    const ui = await $.ui.mount({ ...PANE, surface })
    const root = (await ui.find({ type: 'Box' }))!
    const text = lines(root)
    if (surface === 'terminal') console.log('--- rendered pane (terminal) ---\n' + text.join('\n'))
    expect(text).toContain('BIOS phase 2')
    expect(text).toContain('1/4 done · 1 running · 1 failed · updated 20:00:00 · checked 20:05:00')
    expect(text).toContain('✓ Catalog — 42 attributes')
    expect(text).toContain('● Agent apply — PC-5')
    expect(text).toContain('○ E2E')
    expect(text).toContain('✗ Licence — cert stale')
    expect(text).toContain('broken.json: invalid JSON')
    expect(text).toContain('read 2026/10/15 20:05:00')
    await ui.unmount()
    await $.command.run({ command: 'progress', args: '' }) // toggle closed for the next loop
  }
})

test('missing folder shows "No progress files"', async ($, on) => {
  world(on, null)
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No progress files' })).toBeDefined()
})

test('progressDir defaults to the manifest path', async ($, on) => {
  world(on, null)
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'C:\\Users\\Itamartz\\AthenaDev\\progress' })).toBeDefined()
})

test('progressDir option sets the folder that is listed and read', { options: { progressDir: 'D:\\other\\progress' } }, async ($, on) => {
  const { paths } = world(on, { 'bios-phase2.json': BIOS })
  await $.command.run({ command: 'progress', args: 'refresh' })
  expect(paths).toContain('D:\\other\\progress')
  expect(paths).toContain('D:\\other\\progress\\bios-phase2.json')
})

test('/progress toggles closed, and refresh re-reads', async ($, on) => {
  const state = world(on, {})
  await $.command.run({ command: 'progress', args: '' })
  expect(state.open).toBe(true)
  expect((await $.command.run({ command: 'progress', args: '' })).text).toBe('Progress pane closed.')
  expect(state.open).toBe(false)
  const before = state.lists
  expect((await $.command.run({ command: 'progress', args: 'refresh' })).text).toBe('Progress re-read.')
  expect(state.lists).toBe(before + 1)
})

test('timer re-reads every 10 s, without depending on the pane lookup', async ($, on) => {
  const state = world(on, { 'a.json': BIOS })
  const clock = state.clock
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(10000)
  expect(state.lists).toBe(1)
  await clock.advance(10000)
  expect(state.lists).toBe(2)
})

test('a "now" action shows with its elapsed time', async ($, on) => {
  const withNow = JSON.stringify({ ...JSON.parse(BIOS), now: { action: 'Running Athena.IntegrationTests', since: '2026/10/15 20:01:48' } })
  expect(parseProgress('a.json', withNow).now?.action).toBe('Running Athena.IntegrationTests')
  expect(elapsed('2026/10/15 20:01:48', '2026/10/15 20:05:00')).toBe('3m 12s')
  expect(elapsed('', '2026/10/15 20:05:00')).toBe('')
  world(on, { 'bios-phase2.json': withNow })
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = lines((await ui.find({ type: 'Box' }))!)
  expect(text).toContain('▶ Running Athena.IntegrationTests · 3m 12s')
})

test('a finished file is one green line, with no task list and no "now" line', async ($, on) => {
  const done = JSON.stringify({ title: 'T', updated: '2026/10/15 19:59:00', now: { action: 'Finished', since: '' }, tasks: [{ name: 'a', status: 'done' }, { name: 'b', status: 'done' }] })
  world(on, { 'd.json': done })
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = lines((await ui.find({ type: 'Box' }))!)
  expect(text).toContain('😊 T — done · 2 tasks · updated 19:59:00')
  expect(text.some(l => l.includes('Finished') || l.includes('✓ a'))).toBe(false)
  expect((await ui.find({ type: 'Text', text: '😊 T — done · 2 tasks · updated 19:59:00' }))?.props.color).toBe('success')
})

const DONE = (updated: string) => JSON.stringify({ title: 'Done one', updated, tasks: [{ name: 'a', status: 'done' }] })

test('running files come first, finished after', async ($, on) => {
  // d.json is the newest file, yet it is finished, so it sorts after the running one.
  world(on, { 'd.json': DONE('2026/10/15 20:00:00'), 'bios.json': BIOS })
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = lines((await ui.find({ type: 'Box' }))!)
  expect(text.indexOf('BIOS phase 2')).toBeLessThan(text.indexOf('😊 Done one — done · 1 tasks · updated 20:00:00'))
})

test('clear hides finished files until their "updated" changes', async ($, on) => {
  const folder: Record<string, string> = { 'd.json': DONE('2026/10/15 20:00:00') }
  world(on, folder)
  await $.command.run({ command: 'progress', args: '' })
  expect((await $.command.run({ command: 'progress', args: 'clear' })).text).toBe('Cleared 1 finished.')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No running work' })).toBeDefined()
  await ui.unmount()
  folder['d.json'] = DONE('2026/10/15 20:10:00')
  await $.command.run({ command: 'progress', args: 'refresh' })
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(lines((await again.find({ type: 'Box' }))!)).toContain('😊 Done one — done · 1 tasks · updated 20:10:00')
})

test('a dismissal kept in the store from an earlier session still hides the file', async ($, on) => {
  world(on, { 'd.json': DONE('2026/10/15 20:00:00') }, { dismissed: ['d.json|2026/10/15 20:00:00'] })
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No running work' })).toBeDefined()
})

// Shaped like real off-format files: extra text after the status word, plain-string tasks, now.action "done".
const OFF = {
  'bios-compliance-filters.json': JSON.stringify({ title: 'BIOS compliance', updated: '2026/10/15 23:40:01', now: { action: 'Done', since: '2026/10/15 23:40:01' }, tasks: [{ name: 'bUnit', status: 'done 160/0' }, { name: 'commit', status: 'done' }] }),
  'fix-helper-cli-view.json': JSON.stringify({ title: 'Fix Helper', updated: '2026/10/16 01:02:49', tasks: [{ name: 'baseline', status: 'done: 11402 pass' }, { name: 'E2E', status: 'done: 6/6 pass' }] }),
  'bios-vendors-catalog.json': JSON.stringify({ title: 'BIOS vendors', updated: '2026/10/15 23:26:39', now: { action: 'done', since: '23:26:39' }, tasks: ['read: done', 'unit: 11369/0', 'commit: 4dbb7cad'] }),
  'policies-nav-sort.json': JSON.stringify({ title: 'Policies nav', updated: '2026/10/15 23:27:19', now: { action: 'done', since: '2026/10/15 23:27:19' }, tasks: ['baseline 11365/0 done', 'commit done'] }),
}

test('lenient parse: status first word, aliases, plain-string tasks, now "done"', () => {
  const t = (s: string) => parseProgress('a.json', JSON.stringify({ tasks: [{ name: 'n', status: s }] })).tasks[0]
  expect(t('done: 11402 pass')).toEqual({ name: 'n', status: 'done', detail: '11402 pass' })
  expect(t('OK')).toEqual({ name: 'n', status: 'done', detail: '' })
  expect(t('Completed fine').status).toBe('done')
  expect(t('pass').status).toBe('done')
  expect(t('error: boom')).toEqual({ name: 'n', status: 'failed', detail: 'boom' })
  expect(t('fail').status).toBe('failed')
  expect(t('Running x').status).toBe('running')
  expect(t('later').status).toBe('pending')
  expect(parseProgress('a.json', JSON.stringify({ tasks: [{ name: 'n', status: 'done x', detail: 'kept' }] })).tasks[0].detail).toBe('kept')
  const s = parseProgress('a.json', JSON.stringify({ tasks: ['read: done', 'abandoned later', 'x failed'] })).tasks
  expect(s.map(x => x.status)).toEqual(['done', 'pending', 'failed'])
  expect(s[0]).toEqual({ name: 'read: done', status: 'done', detail: '' })
  for (const [name, text] of Object.entries(OFF)) {
    const f = parseProgress(name, text)
    expect(isFinished(f)).toBe(true)
    expect(f.now).toBe(undefined)
  }
})

test('off-format finished files render as one smiley line and clear hides them', async ($, on) => {
  world(on, OFF)
  await $.command.run({ command: 'progress', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = lines((await ui.find({ type: 'Box' }))!)
  expect(text).toContain('😊 BIOS compliance — done · 2 tasks · updated 23:40:01')
  expect(text).toContain('😊 Fix Helper — done · 2 tasks · updated 01:02:49')
  expect(text).toContain('😊 BIOS vendors — done · 3 tasks · updated 23:26:39')
  expect(text).toContain('😊 Policies nav — done · 2 tasks · updated 23:27:19')
  expect(text.some(l => l.startsWith('▶') || l.includes('unit: 11369/0'))).toBe(false)
  await ui.unmount()
  expect((await $.command.run({ command: 'progress', args: 'clear' })).text).toBe('Cleared 4 finished.')
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: 'No running work' })).toBeDefined()
})
