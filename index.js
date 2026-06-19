const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');
const config = require('./config');
const { fuelTypes, geoRegex } = require('./consts');

const { getDistance } = require('./utils/geo');
const { parseFrenchHours } = require('./utils/timeParser');
const { getMapUrl } = require('./utils/maps');
const { clickLogger } = require('./middlewares/logger');
const { handleUnexpectedError } = require('./utils/errors');
const { capitalize, getTxt } = require('./utils/text');
const { handleFuelSelection } = require('./handlers/fuelHandler');

const bot = new Telegraf(TOKEN);
bot.use(session());
bot.use(clickLogger);

const sendMainMenu = async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.location = null;
    ctx.session.userCoords = null;
    await ctx.reply(getTxt(ctx, 'enter_city'), Markup.keyboard([
        ['/start', '/help']
    ]).resize());
};

bot.start(async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.lang = 'ru';
    ctx.session.country = 'FR';
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

bot.on('text', async (ctx) => {
    const rawInput = ctx.message.text.trim();
    if (rawInput.startsWith('/')) return;

    ctx.session = ctx.session || {};
    ctx.session.country = 'FR';

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
        ctx.session.userCoords = null;
        ctx.session.location = capitalize(rawInput);
    }

    const text = getTxt(ctx, 'select_fuel').replace('{city}', ctx.session.location);
    await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('⛽️ Diesel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
        [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')],
        [Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]
    ]));
});

bot.on(['photo', 'video', 'sticker', 'voice', 'audio', 'document', 'animation', 'location'], async (ctx) => {
    await ctx.replyWithMarkdown(getTxt(ctx, 'error_media_not_supported'));
});

// Роутер для выбора типа топлива (логика вынесена в handlers/fuelHandler.js)
bot.action(/^fuel_(.+)$/, handleFuelSelection);

// Роутер для обработки результатов поиска и фильтрации
bot.action(/^filter_(all|open)_(price|dist)_(fuel_.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });

        const filterType = ctx.match[1];
        const sortType = ctx.match[2];
        const fuelKey = ctx.match[3];
        const fuel = fuelTypes[fuelKey];
        const location = ctx.session?.location;

        if (!location) return ctx.replyWithMarkdown(getTxt(ctx, 'error_session_expired'));

        const loadingText = getTxt(ctx, 'searching_fuel').replace('{fuel}', fuel.label);
        await ctx.editMessageText(loadingText).catch(() => { });

        let response;

        if (ctx.session?.userCoords) {
            const { lat, lon } = ctx.session.userCoords;
            response = await axios.get(config.FRANCE_API_URL, {
                params: {
                    where: `within_distance(geom, geom'POINT(${lon} ${lat})', 30km) AND ${fuel.frField} > 0`,
                    order_by: `${fuel.frField} ASC`,
                    limit: 40
                }
            });
        } else {
            const apiLocation = location.toUpperCase();
            response = await axios.get(config.FRANCE_API_URL, {
                params: {
                    where: `ville LIKE "${apiLocation}*" AND ${fuel.frField} > 0`,
                    order_by: `${fuel.frField} ASC`,
                    limit: 40
                }
            });
        }

        if (!response.data?.results || response.data.results.length === 0) {
            const errorText = !ctx.session?.userCoords
                ? getTxt(ctx, 'error_city_not_found').replace('{location}', location)
                : getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);

            return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([
                [Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]
            ]));
        }

        const seenAddresses = new Set();

        let records = response.data.results.map(station => {
            let distance = Infinity;
            if (ctx.session?.userCoords && station.geom) {
                distance = getDistance(ctx.session.userCoords.lat, ctx.session.userCoords.lon, station.geom.lat, station.geom.lon);
            }
            return {
                price: station[fuel.frField],
                name: station.nom ? ` — ${station.nom}` : '',
                address: station.adresse || '---',
                city: station.ville || location,
                distance: distance,
                geom: station.geom,
                horaires: station.horaires,
                horaires_automate_24_24: station.horaires_automate_24_24,
                horaires_jour: station.horaires_jour
            };
        }).filter(station => {
            const addr = station.address.toLowerCase().trim();
            if (seenAddresses.has(addr)) return false;
            seenAddresses.add(addr);
            return true;
        });

        if (filterType === 'open') {
            records = records.filter(station => {
                const hoursStatus = parseFrenchHours(station, 'ru');
                return hoursStatus.includes('24/7') || hoursStatus.toLowerCase().includes('открыто');
            });
        }

        if (records.length === 0) {
            const closedText = getTxt(ctx, 'error_all_stations_closed')
                .replace('{location}', location)
                .replace('{fuel}', fuel.label);

            return ctx.replyWithMarkdown(closedText, Markup.inlineKeyboard([
                [Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]
            ]));
        }

        if (sortType === 'dist') {
            records.sort((a, b) => a.distance - b.distance);
        }

        records = records.slice(0, config.STATIONS_LIMIT);

        const reportKey = filterType === 'open' ? 'report_title_open' : 'report_title_all';
        let report = getTxt(ctx, reportKey).replace('{location}', location);

        records.forEach((station, index) => {
            const icon = index === 0 ? '🥇' : '📍';
            const distInfo = station.distance !== Infinity ? ` 🚗 *(${station.distance} км)*` : '';
            const timeInfo = parseFrenchHours(station, 'ru');

            const mapUrl = getMapUrl(ctx, station);

            report += `${icon} *${station.price}€*${distInfo}${station.name}\n🏠 ${station.address}\n🕒 ${timeInfo}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
        });

        await ctx.replyWithMarkdown(report, Markup.inlineKeyboard([
            [Markup.button.callback(getTxt(ctx, 'search_again'), 'main_menu')]
        ]));

    } catch (error) {
        await handleUnexpectedError(ctx, error);
    }
});

bot.launch().then(() => console.log('🚀 Бот успешно запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));