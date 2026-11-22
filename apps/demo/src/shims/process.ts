const p = (globalThis as any).process;
export const env = p.env;
export const cwd = p.cwd;
export const nextTick = p.nextTick;
export const platform = p.platform;
export default p;
