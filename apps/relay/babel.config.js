/* eslint-disable no-undef -- Babel config loaded by Node in CommonJS mode; module is an ambient Node global. */
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
