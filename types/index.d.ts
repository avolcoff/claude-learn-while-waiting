export type Pick = number

declare module 'claude-code' {
  interface PluginState {
    'learn-while-waiting': {
      pick: Pick
      isWorking: boolean
      isPlaying: boolean
      isPausedByUs: boolean
      isEnabled: boolean
      waitSeconds: number
      returnTo: string
    }
  }
}
