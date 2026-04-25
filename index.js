const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');
const i18n = require('./i18n');

const bot = new Telegraf(TOKEN);
const API_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

const userState = {};

const mainKeyboard = Markup.keyboard([
    ['/start', '/help']
]).resize();

const getTxt = (ctx, key) => {
    const langCode = ctx.from.language_code;
    const supportedLangs = ['ru', 'uk', 'pl', 'fr'];
    const lang = supportedLangs.includes(langCode) ? langCode : 'en';
    return i18n[lang][key] || i18n['en'][key];
};

const fuelTypes = {
    'fuel_gazole': { label: 'Disel', field: 'gazole_prix' },
    'fuel_e10':    { label: 'E10',   field: 'e10_prix' },
    'fuel_sp98':   { label: 'SP98',  field: 'sp98_prix' },
    'fuel_gplc':   { label: 'GPL',   field: 'gplc_prix' }
};

bot.start((ctx) => {
    ctx.reply(getTxt(ctx, 'welcome'), mainKeyboard);
});

bot.help((ctx) => {
    ctx.replyWithMarkdown(getTxt(ctx, 'help'), mainKeyboard);
});

bot.on('text', async (ctx) => {
    const city = ctx.message.text.trim().toUpperCase();
    if (city === '/START' || city === '/HELP') return;
    
    userState[ctx.chat.id] = city;
    
    const text = getTxt(ctx, 'select_fuel').replace('{city}', city);
    await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('⛽️ Disel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
        [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')]
    ]));
});

bot.action(/fuel_(.+)/, async (ctx) => {
    const actionData = ctx.match[0];
    const fuel = fuelTypes[actionData];
    const city = userState[ctx.chat.id];

    if (!city) return ctx.reply(getTxt(ctx, 'welcome'));

    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText(getTxt(ctx, 'searching').replace('{fuel}', fuel.label).replace('{city}', city));

        const response = await axios.get(API_URL, {
            params: {
                where: `ville LIKE "${city}*" AND ${fuel.field} > 0`,
                order_by: `${fuel.field} ASC`,
                limit: 30 
            }
        });

        let records = response.data.results;

        if (!records || records.length === 0) {
            return ctx.reply(getTxt(ctx, 'not_found').replace('{fuel}', fuel.label).replace('{city}', city));
        }

        const seenAddresses = new Set();
        records = records.filter(station => {
            const addr = (station.adresse || '').toLowerCase().trim();
            if (seenAddresses.has(addr)) return false;
            seenAddresses.add(addr);
            return true;
        }).slice(0, 10);

        let report = getTxt(ctx, 'top_title').replace('{fuel}', fuel.label).replace('{city}', city);

records.forEach((station, index) => {
    const price = station[fuel.field];
    const address = station.adresse || '---';
    const name = station.nom || '---'; 
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ' ' + city)}`;
    
    const icon = index === 0 ? '🥇' : '📍';
    report += `${icon} *${price}€* — ${name}\n🏠 ${address}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
});

        await ctx.replyWithMarkdown(report);

    } catch (error) {
        console.error('Ошибка:', error.message);
        ctx.reply(getTxt(ctx, 'error'));
    }
});

bot.launch().then(() => console.log('✅ Бот запущен и готов к работе!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));