const { Markup } = require('telegraf');

const handleUnexpectedError = async (ctx, error) => {
  console.error('💥 Критическая ошибка:', error.message || error);

  const i18n = require('../i18n');
  const lang = ctx.session?.lang || 'ru';
  const errorText = i18n[lang]?.unexpected_error || '🤖 Произошла непредвиденная ошибка при обработке запроса. Пожалуйста, попробуйте позже.';
  const mainMenuText = i18n[lang]?.main_menu || '🔙 В меню';

  try {
    await ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([
      [Markup.button.callback(mainMenuText, 'main_menu')]
    ]));
  } catch (e) {
    console.error('Не удалось отправить сообщение об ошибке пользователю:', e.message);
  }
};

module.exports = { handleUnexpectedError };