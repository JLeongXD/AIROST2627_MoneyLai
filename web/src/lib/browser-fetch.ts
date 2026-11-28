// SDKs may detach a supplied function or call it as an object method.
// Always preserve the browser receiver, including in strict iPhone WebViews.
export const browserFetch: typeof fetch = (input, init) => {
  const scope = typeof window === "undefined" ? globalThis : window;
  return scope.fetch.call(scope, input, init);
};
