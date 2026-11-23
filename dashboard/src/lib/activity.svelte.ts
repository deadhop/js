// What the dashboard is doing right now, for the status bar and the loading
// screens: the calls waiting for the service, the step each one is at (the
// signer, the relays, the service), and the last answer or failure.
import type { ActivityEvent, ActivityListener, ActivityStep } from '@deadhop/client';
import { untrack } from 'svelte';

/** A step of a call that has started and not ended. */
export interface PendingStep {
  key: string;
  step: ActivityStep;
  since: number;
}

/** A call to the service that has not been answered yet. */
export interface PendingCall {
  id: number;
  tool: string;
  since: number;
}

/** The last thing that went wrong (cleared by the next answer). */
export interface Failure {
  what: string;
  message: string;
  at: number;
}

export class Activity {
  steps = $state<PendingStep[]>([]);
  calls = $state<PendingCall[]>([]);
  /** Something bigger than one call that is under way (signing in), with when it began. */
  task = $state<{ label: string; since: number } | null>(null);
  lastAnswer = $state<number | null>(null);
  failure = $state<Failure | null>(null);
  #connections = 0;
  #calls = 0;

  constructor(readonly now: () => number = Date.now) {}

  /** A listener for one connection's steps (each connection numbers its own). */
  listener(): ActivityListener {
    const conn = ++this.#connections;
    return (e: ActivityEvent) => {
      if (e.type === 'receive') return;
      const key = `${conn}:${e.id}`;
      // Calls start inside components' effects: recording one must not make
      // those effects depend on (and re-run with) the activity itself.
      untrack(() => {
        if (e.type === 'start') this.steps = [...this.steps, { key, step: e.step, since: this.now() }];
        else this.steps = this.steps.filter((s) => s.key !== key);
      });
    };
  }

  /** Run one call to the service, recording it while it waits. */
  async track<T>(tool: string, work: () => Promise<T>): Promise<T> {
    const id = ++this.#calls;
    untrack(() => (this.calls = [...this.calls, { id, tool, since: this.now() }]));
    try {
      const value = await work();
      this.lastAnswer = this.now();
      this.failure = null;
      return value;
    } catch (e) {
      this.fail(toolLabel(tool), e);
      throw e;
    } finally {
      untrack(() => (this.calls = this.calls.filter((c) => c.id !== id)));
    }
  }

  /** Run a bigger piece of work (signing in) under one label. */
  async run<T>(label: string, work: () => Promise<T>): Promise<T> {
    this.task = { label, since: this.now() };
    try {
      return await work();
    } catch (e) {
      this.fail(label, e);
      throw e;
    } finally {
      this.task = null;
    }
  }

  fail(what: string, e: unknown) {
    this.failure = { what, message: e instanceof Error ? e.message : String(e), at: this.now() };
  }

  /** Forget everything (signing out). */
  reset() {
    this.steps = [];
    this.calls = [];
    this.task = null;
    this.lastAnswer = null;
    this.failure = null;
  }
}

/** The one shared by every page. */
export const activity = new Activity();

const LABELS: Record<string, string> = {
  add_operator: 'Adding an operator',
  backup_database: 'Making a backup',
  check_proxy: 'Checking the proxy',
  check_relays: 'Checking the relays',
  control_service: 'Sending the command',
  create_invoice: 'Creating the invoice',
  get_audit_log: 'Loading the audit log',
  get_health: 'Loading service health',
  get_info: 'Loading service details',
  get_invoice: 'Loading the invoice',
  get_metrics: 'Loading totals',
  get_payment_series: 'Loading the payment chart',
  get_privacy_audit: 'Running the privacy audit',
  get_relay_history: 'Loading relay history',
  get_settings: 'Loading settings',
  get_stats: 'Loading invoice counts',
  list_backups: 'Loading backups',
  list_invoices: 'Loading invoices',
  remove_operator: 'Removing an operator',
  reset_settings: 'Resetting settings',
  resolve_i2p_name: 'Looking up an I2P name',
  update_settings: 'Saving settings',
  wipe_database: 'Wiping the database',
};

/** What a call does, in words. */
export function toolLabel(tool: string): string {
  return LABELS[tool] ?? tool.replaceAll('_', ' ');
}

/** When waiting turns from normal into slow, and from slow into a problem. */
export interface Limits {
  /** A refresh in the background shows only once it has waited this long, so the bar does not flicker. */
  quietMs: number;
  slowMs: number;
  stuckMs: number;
}

export const LIMITS: Limits = { quietMs: 1_000, slowMs: 5_000, stuckMs: 15_000 };

export type Tone = 'idle' | 'busy' | 'slow' | 'problem';

/** One line for the status bar. */
export interface Status {
  tone: Tone;
  /** What is being done (or the last outcome). */
  what: string;
  /** Where it is at, or what went wrong. */
  text: string;
  /** Since when, for a ticking counter; null when nothing is waiting. */
  since: number | null;
  /** Requests still waiting. */
  waiting: number;
}

const SIGNER: Partial<Record<ActivityStep, string>> = {
  key: 'Waiting for your signer to share your public key',
  sign: 'Waiting for your signer to sign the request',
  encrypt: 'Waiting for your signer to encrypt the request',
  decrypt: 'Waiting for your signer to decrypt the reply',
};

/** The status line for `a` at `now`. */
export function describe(a: Pick<Activity, 'steps' | 'calls' | 'task' | 'lastAnswer' | 'failure'>, now: number, limits: Limits = LIMITS): Status {
  const waiting = a.calls.length;
  const first = a.calls[0];
  const what =
    first === undefined
      ? (a.task?.label ?? '')
      : waiting === 1
        ? toolLabel(first.tool)
        : `${toolLabel(first.tool)} and ${waiting - 1} more`;
  const since = first?.since ?? a.task?.since ?? null;
  // Once something has answered, a short refresh is not worth mentioning.
  if (since === null || (a.lastAnswer !== null && a.failure === null && a.task === null && now - since < limits.quietMs)) {
    if (a.failure !== null) return { tone: 'problem', what: `${a.failure.what} failed`, text: a.failure.message, since: null, waiting };
    return { tone: 'idle', what: a.lastAnswer === null ? 'Ready' : 'Up to date', text: '', since: null, waiting };
  }
  const elapsed = now - since;
  // The oldest unfinished step says where the wait is.
  const step = a.steps[0];
  if (step !== undefined && step.step !== 'publish') {
    const slow = now - step.since >= limits.slowMs;
    return {
      tone: slow ? 'slow' : 'busy',
      what,
      text: slow ? `${SIGNER[step.step]}. If it is a browser extension, it may be asking you to approve.` : SIGNER[step.step]!,
      since,
      waiting,
    };
  }
  if (step !== undefined) {
    const stepElapsed = now - step.since;
    if (stepElapsed >= limits.stuckMs) return { tone: 'problem', what, text: 'No relay has accepted the request yet. Still trying.', since, waiting };
    if (stepElapsed >= limits.slowMs) return { tone: 'slow', what, text: 'The relays are slow to accept the request', since, waiting };
    return { tone: 'busy', what, text: 'Sending to the relays', since, waiting };
  }
  if (elapsed >= limits.stuckMs) {
    return { tone: 'problem', what, text: 'No answer from the service yet. The relays may be slow or dropping replies. Still waiting.', since, waiting };
  }
  if (elapsed >= limits.slowMs) return { tone: 'slow', what, text: 'The service is slow to answer', since, waiting };
  return { tone: 'busy', what, text: 'Waiting for the service', since, waiting };
}

/** `12_400` -> `12 s`, `75_000` -> `1 min 15 s`. */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
