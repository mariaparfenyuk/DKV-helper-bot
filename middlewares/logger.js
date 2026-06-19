const clickLogger = async (ctx, next) => {
  if (ctx.callbackQuery) {
    console.log(`=== КЛИК ПО КНОПКЕ === User: ${ctx.from?.username || ctx.from?.id} | Data: "${ctx.callbackQuery.data}"`);
  }
  return next();
};

module.exports = { clickLogger };