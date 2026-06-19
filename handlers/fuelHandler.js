const { Markup } = require('telegraf');
const { fuelTypes } = require('../consts');
const { getTxt } = require('../utils/text');

const handleFuelSelection = async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => { });

    const fuelKey = ctx.match[0];
    const fuel = fuelTypes[fuelKey];
    const location = ctx.session?.location;
    const hasCoords = !!ctx.session?.userCoords;

    if (!location) return ctx.replyWithMarkdown(getTxt(ctx, 'error_session_expired'));

    const menuText = getTxt(ctx, 'filter_menu_title')
      .replace('{city}', location)
      .replace('{fuel}', fuel.label);

    let keyboard = [];

    if (!hasCoords) {
      keyboard = [
        [
          Markup.button.callback(getTxt(ctx, 'filter_all'), `filter_all_price_${fuelKey}`),
          Markup.button.callback(getTxt(ctx, 'filter_open_now'), `filter_open_price_${fuelKey}`)
        ]
      ];
    } else {
      keyboard = [
        [
          Markup.button.callback(getTxt(ctx, 'filter_all_price'), `filter_all_price_${fuelKey}`),
          Markup.button.callback(getTxt(ctx, 'filter_all_dist'), `filter_all_dist_${fuelKey}`)
        ],
        [
          Markup.button.callback(getTxt(ctx, 'filter_open_price'), `filter_open_price_${fuelKey}`),
          Markup.button.callback(getTxt(ctx, 'filter_open_dist'), `filter_open_dist_${fuelKey}`)
        ]
      ];
    }

    keyboard.push([Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]);

    await ctx.editMessageText(menuText, Markup.inlineKeyboard(keyboard)).catch(() => { });
  } catch (e) {
    console.error('Ошибка в меню фильтра:', e.message);
  }
};

module.exports = { handleFuelSelection };