export type ProgressTask = { name: string; status: 'done' | 'running' | 'pending' | 'failed'; detail: string }
export type ProgressFile = { file: string; title: string; updated: string; tasks: ProgressTask[]; error?: string; finished?: boolean; now?: { action: string; since: string } }

declare module 'claude-code' {
  interface PluginState {
    'athena-progress': { files: ProgressFile[]; readAt: string; dismissed: string[] }
  }
}
