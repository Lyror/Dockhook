export type Action = 'update_container' | 'restart_container' | 'run_userscript';

export const ACTIONS: readonly Action[] = [
  'update_container',
  'restart_container',
  'run_userscript',
];

export type ActionResult =
  | { ok: true; summary: string; output: string }
  | { ok: false; message: string; output: string };
