export const profileAdapter = <T>(factory: T): T => factory;
export const profilerExtension = { name: "query-profiler" };
export const withProfiler = <T>(options: T): T => options;
export const profilePool = <T>(pool: T): T => pool;
export const profilePrisma = <T>(client: T): T => client;
export const stampPlugin = () => ({});
export const profileTask = async <T>(_name: string, task: () => T | PromiseLike<T>): Promise<T> =>
  task();
