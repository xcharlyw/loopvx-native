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
