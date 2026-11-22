// @Interval handlers are collected here and started by the browser runtime with setInterval.
export const intervals: { target: object; key: string | symbol; ms: number }[] = [];

export function Interval(ms: number) {
  return (target: object, key: string | symbol) => {
    intervals.push({ target, key, ms });
  };
}

export class ScheduleModule {
  static forRoot() {
    return { module: ScheduleModule };
  }
}
