const { Telegraf, Markup, session } = require('telegraf');
const { TOKEN } = require('./token');
const config = require('./config');
const { fuelTypes, geoRegex } = require('./consts');

const { getMapUrl } = require('./utils/maps');
const { clickLogger } = require('./middlewares/logger');
const { handleUnexpectedError } = require('./utils/errors');
const { capitalize, getTxt } = require('./utils/text');
const { handleFuelSelection } = require('./handlers/fuelHandler');
const { handleSearchRequest } = require('./handlers/searchHandler');
const { getCoordsByText } = require('./utils/geocoder');

// Импорты ТОЛЬКО рабочих и стабильных апдейтеров данных
const { initSpainUpdater } = require('./utils/spainApi');
const { initItalyUpdater } = require('./utils/italyApi');

const bot = new Telegraf(TOKEN);
bot.use(session());
bot.use(clickLogger);

const sendMainMenu = async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.location = null;
    ctx.session.userCoords = null;
    ctx.session.country = null;

    // В меню выбора стран остались только 100% рабочие европейские регионы
    await ctx.reply(
        getTxt(ctx, 'choose_country'),
        Markup.inlineKeyboard([
            [Markup.button.callback('🇫🇷 France', 'set_country_FR'), Markup.button.callback('🇩🇪 Deutschland', 'set_country_DE')],
            [Markup.button.callback('🇪🇸 España', 'set_country_ES'), Markup.button.callback('🇦🇹 Österreich', 'set_country_AT')],
            [Markup.button.callback('🇮🇹 Italia', 'set_country_IT'), Markup.button.callback('🇱🇺 Luxembourg', 'set_country_LU')]
        ])
    );
};

bot.start(async (ctx) => {
    ctx.session = ctx.session || {};

    const userLang = ctx.from.language_code;
    ctx.session.lang = ['uk', 'pl', 'de', 'fr', 'ru'].includes(userLang) ? userLang : 'en';

    await sendMainMenu(ctx);
});

bot.help((ctx) => {
    ctx.replyWithMarkdown(getTxt(ctx, 'help'));
});

bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    await ctx.deleteMessage().catch(() => { });
    await sendMainMenu(ctx);
});

// Валидация регулярного выражения строго под наш актуальный список стабильных стран
bot.action(/^set_country_(FR|DE|ES|AT|IT|LU)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        const country = ctx.match[1];

        ctx.session = ctx.session || {};
        ctx.session.country = country;

        const welcomeText = getTxt(ctx, `country_chosen_${country}`);

        await ctx.reply(welcomeText, Markup.keyboard([
            [Markup.button.locationRequest(getTxt(ctx, 'my_location'))],
            ['/start', '/help']
        ]).resize());

        await ctx.deleteMessage().catch(() => { });
    } catch (e) {
        console.error('Ошибка выбора страны:', e.message);
    }
});

bot.on('text', async (ctx) => {
    try {
        const rawInput = ctx.message.text.trim();
        if (rawInput.startsWith('/')) return;

        ctx.session = ctx.session || {};
        const country = ctx.session.country || 'FR';

        const looksLikeCoords = /[\d.,]/g.test(rawInput) && (rawInput.includes(',') || rawInput.includes('.'));

        if (geoRegex.test(rawInput)) {
            const [lat, lon] = rawInput.split(',').map(coord => parseFloat(coord.trim()));
            ctx.session.userCoords = { lat, lon };
            ctx.session.location = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        } else if (looksLikeCoords) {
            return ctx.replyWithMarkdown(getTxt(ctx, 'error_coords_format'));
        } else {
            if (rawInput.length < 2 || rawInput.length > 50) {
                return ctx.replyWithMarkdown(getTxt(ctx, 'error_city_length'));
            }

            if (country === 'FR') {
                ctx.session.userCoords = null;
                ctx.session.location = capitalize(rawInput);
            } else {
                const loadingMsg = await ctx.reply('🔍 Geocoding...');
                const coordsData = await getCoordsByText(rawInput, country);

                await ctx.deleteMessage(loadingMsg.message_id).catch(() => { });

                if (!coordsData) {
                    return ctx.replyWithMarkdown(getTxt(ctx, 'error_city_not_found').replace('{location}', rawInput));
                }

                ctx.session.userCoords = { lat: coordsData.lat, lon: coordsData.lon };
                ctx.session.location = coordsData.name;
            }
        }

        const text = getTxt(ctx, 'select_fuel').replace('{city}', ctx.session.location);
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('⛽️ Diesel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
            [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')],
            [Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]
        ]));

    } catch (error) {
        await handleUnexpectedError(ctx, error);
    }
});

bot.on('location', async (ctx) => {
    try {
        ctx.session = ctx.session || {};

        const { latitude, longitude } = ctx.message.location;

        ctx.session.userCoords = { lat: latitude, lon: longitude };
        ctx.session.location = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

        const text = getTxt(ctx, 'select_fuel').replace('{city}', ctx.session.location);
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('⛽️ Diesel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
            [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')],
            [Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]
        ]));
    } catch (error) {
        await handleUnexpectedError(ctx, error);
    }
});

bot.on(['photo', 'video', 'sticker', 'voice', 'audio', 'document', 'animation'], async (ctx) => {
    await ctx.replyWithMarkdown(getTxt(ctx, 'error_media_not_supported'));
});

bot.action(/^fuel_(.+)$/, handleFuelSelection);
bot.action(/^filter_(all|open)_(price|dist)_(fuel_.+)$/, handleSearchRequest);

// Запуск фонового кэширования для стран со стабильными API
initSpainUpdater();
initItalyUpdater();

// Запуск бота в продакшн
bot.launch().then(() => console.log('🚀 Бот успешно запущен на стабильном пуле стран!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));