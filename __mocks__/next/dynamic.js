// Jest mock for next/dynamic — makes dynamic imports synchronous in tests.
// This allows jest.mock("some-module") to intercept the dynamically imported
// module in the same tick, so Monaco mocks work from the first test.
const dynamic = (fn, _options) => {
  let Component = null;

  // Call the loader synchronously and capture the module.
  // Works because Jest replaces ESM default exports via jest.mock().
  const result = fn();
  if (result && typeof result.then === "function") {
    // If the loader is async (real dynamic import), we fall back to the
    // loading component during tests (acceptable for non-Monaco tests).
    // But when jest.mock() intercepts the import, fn() resolves synchronously.
    let resolved = false;
    result.then((mod) => {
      Component = mod.default ?? mod;
      resolved = true;
    });
    if (!resolved) {
      // Return a synchronous wrapper; during the same microtask tick,
      // jest.mock intercepted imports resolve immediately.
      return function DynamicComponent(props) {
        if (Component) {
          return require("react").createElement(Component, props);
        }
        if (_options && _options.loading) {
          return require("react").createElement(_options.loading, null);
        }
        return null;
      };
    }
  } else if (result && (result.default || typeof result === "function")) {
    Component = result.default ?? result;
  }

  return function DynamicComponent(props) {
    if (Component) {
      return require("react").createElement(Component, props);
    }
    if (_options && _options.loading) {
      return require("react").createElement(_options.loading, null);
    }
    return null;
  };
};

module.exports = dynamic;
module.exports.default = dynamic;
