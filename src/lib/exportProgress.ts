import { setState } from './store';

/** What the progress card shows: the job, the step that runs now, how far (0..1) and whether it has finished. */
export interface ExportProgress {
  title: string;
  label: string;
  value: number;
  done: boolean;
}

/** Share of the work that is done, kept between 0 and 1. */
export const progressValue = (done: number, total: number): number => (total <= 0 ? 0 : Math.min(1, Math.max(0, done / total)));

/** "37 %" for a value between 0 and 1. */
export const percentText = (value: number): string => `${Math.floor(progressValue(value, 1) * 100)} %`;

let run = 0;

/**
 * A progress card for a long job, like the bar in Ableton: `step` names what starts now (and lets the screen repaint before the heavy
 * work begins), `advance` counts finished work (the weights add up to `total`), `finish` shows 100 % and hides the card after a few
 * seconds, `fail` hides it at once.
 */
export function startProgress(title: string, total: number) {
  let done = 0;
  const mine = ++run;
  const show = (label: string, value: number, finished: boolean) => setState({ exportProgress: { title, label, value, done: finished } });
  show('Start …', 0, false);
  return {
    step: async (label: string) => {
      show(label, progressValue(done, total), false);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
    advance: (weight = 1) => {
      done += weight;
    },
    finish: (label: string) => {
      show(label, 1, true);
      setTimeout(() => {
        if (run === mine) setState({ exportProgress: null });
      }, 4000);
    },
    fail: () => {
      if (run === mine) setState({ exportProgress: null });
    },
  };
}
