const { Telegraf } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');

const bot = new Telegraf(TOKEN);

const API_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

bot.start((ctx) => {
    ctx.reply('Bonjour! Введите название города во Франции (например, Paris или Lyon).');
});

bot.on('text', async (ctx) => {
    const city = ctx.message.text.trim().toUpperCase();
    
    try {
        await ctx.sendChatAction('typing');

        const response = await axios.get(API_URL, {
            params: {
                where: `ville LIKE "${city}*"`, 
                limit: 15,
                order_by: 'gazole_prix ASC'
            }
        });

        const records = response.data.results;

        if (!records || records.length === 0) {
            return ctx.reply(`Ничего не найдено для "${city}". Попробуйте написать название на французском.`);
        }

        let report = `⛽️ **Цены на АЗС в ${city} (топ 15):**\n\n`;

        records.forEach(station => {
            const name = station.nom || 'АЗС';
            const address = station.adresse || 'Адрес не указан';
            const stationCity = station.ville || '';
            
            let prices = [];
            if (station.gazole_prix) prices.push(`⛽️ Дизель: *${station.gazole_prix}€*`);
            if (station.sp95_prix)   prices.push(`🔹 SP95: *${station.sp95_prix}€*`);
            if (station.e10_prix)    prices.push(`🔹 E10: *${station.e10_prix}€*`);
            if (station.sp98_prix)   prices.push(`🔹 SP98: *${station.sp98_prix}€*`);

            if (prices.length > 0) {
                report += `📍 *${name}* (${stationCity})\n🏠 ${address}\n${prices.join('\n')}\n\n`;
            }
        });

        await ctx.replyWithMarkdown(report);

    } catch (error) {
        console.error('Ошибка API:', error.message);
        ctx.reply('Произошла ошибка при получении данных от французского сервера. Попробуйте еще раз.');
    }
});

bot.launch().then(() => console.log('✅ Бот успешно запущен и готов к работе!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));