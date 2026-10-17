import { progressValue } from './exportProgress';
import { setState } from './store';

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
