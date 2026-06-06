const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');
const i18n = require('./i18n');

const bot = new Telegraf(TOKEN);

bot.use(session());

const API_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

const SUPPORTED_LANGS = ['ru', 'uk', 'pl', 'fr'];

const mainKeyboard = Markup.keyboard([
    ['/start', '/help', '/lang']
]).resize();

const getUserLang = (ctx) => {
    if (ctx.session && ctx.session.lang) return ctx.session.lang;

    const tgLang = ctx.from?.language_code;
    return SUPPORTED_LANGS.includes(tgLang) ? tgLang : 'en';
};

const getTxt = (ctx, key) => {
    const lang = getUserLang(ctx);
    return i18n[lang]?.[key] || i18n['en']?.[key] || `[${key}]`;
};

const fuelTypes = {
    'fuel_gazole': { label: 'Diesel', field: 'gazole_prix' },
    'fuel_e10': { label: 'E10', field: 'e10_prix' },
    'fuel_sp98': { label: 'SP98', field: 'sp98_prix' },
    'fuel_gplc': { label: 'GPL', field: 'gplc_prix' }
};

const getLangKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🇷🇺 Русский', 'set_lang_ru'), Markup.button.callback('🇺🇦 Українська', 'set_lang_uk')],
        [Markup.button.callback('🇵🇱 Polski', 'set_lang_pl'), Markup.button.callback('🇫🇷 Français', 'set_lang_fr')],
        [Markup.button.callback('🇬🇧 English', 'set_lang_en')]
    ]);
};

bot.start(async (ctx) => {
    ctx.session = ctx.session || {};

    const tgLang = ctx.from?.language_code;

    if (!SUPPORTED_LANGS.includes(tgLang)) {
        ctx.session.lang = 'en';
        await ctx.reply('👋 Hello! Your system language is not fully supported yet. Please select your preferred language below:', mainKeyboard);
        return ctx.reply('Choose language / Выберите язык:', getLangKeyboard());
    }

    ctx.session.lang = tgLang;
    await ctx.reply(getTxt(ctx, 'welcome'), mainKeyboard);
});

bot.help((ctx) => {
    ctx.replyWithMarkdown(getTxt(ctx, 'help'), mainKeyboard);
});

bot.command('lang', (ctx) => {
    ctx.reply(getTxt(ctx, 'choose_language') || 'Choose language:', getLangKeyboard());
});

bot.action(/set_lang_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const selectedLang = ctx.match[1];

    ctx.session = ctx.session || {};
    ctx.session.lang = selectedLang;

    const successMessages = {
        ru: 'Язык успешно изменен!',
        uk: 'Мову успішно змінено!',
        pl: 'Język został zmieniony!',
        fr: 'Langue changée avec succès!',
        en: 'Language changed successfully!'
    };

    await ctx.editMessageText(successMessages[selectedLang] || successMessages['en']);
    await ctx.reply(getTxt(ctx, 'welcome'), mainKeyboard);
});


bot.on('text', async (ctx) => {
    const city = ctx.message.text.trim().toUpperCase();
    if (city.startsWith('/')) return;

    ctx.session = ctx.session || {};
    ctx.session.city = city;

    const text = getTxt(ctx, 'select_fuel').replace('{city}', city);
    await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('⛽️ Diesel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
        [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')]
    ]));
});

bot.action(/fuel_(.+)/, async (ctx) => {
    const actionData = ctx.match[0];
    const fuel = fuelTypes[actionData];
    const city = ctx.session?.city;

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

        let report = getTxt(ctx, 'top_title').replace('{fuel}', fuel.label).replace('{city}', city) + '\n\n';

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