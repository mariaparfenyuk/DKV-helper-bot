const i18n = require('../i18n');

const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

const getTxt = (ctx, key) => {
  const lang = ctx.session?.lang || 'ru';
  return i18n[lang]?.[key] || `[${key}]`;
};

module.exports = {
  capitalize,
  getTxt
};