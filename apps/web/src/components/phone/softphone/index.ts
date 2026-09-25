/*
 * The softphone's presentational layer: props in, callbacks out, no provider.
 * components/phone/* feed these from usePhone(); /design-preview feeds them
 * mock calls.
 */
export * from './format';
export * from './shortcuts';
export { ActiveCallView, type ActiveCallViewProps } from './active-call-view';
export { ConnectionNotice, type ConnectionNoticeProps } from './connection-notice';
export {
  CallerIdSelect,
  DeviceSettings,
  IdleView,
  type DeviceOption,
  type IdleTab,
  type IdleViewProps,
} from './idle-view';
export { IncomingCallView, type IncomingCallViewProps } from './incoming-call-view';
export { Keypad, KEYPAD_KEYS, type KeypadProps } from './keypad';
export { SoftphoneLauncher, type SoftphoneLauncherProps } from './launcher';
export { RecentCallsList, type RecentCallsListProps } from './recent-calls';
export { SoftphoneShell, type SoftphoneShellProps } from './shell';
export { ShortcutsSheet } from './shortcuts-sheet';
export { WrapUpView, type WrapUpViewProps } from './wrap-up-view';
