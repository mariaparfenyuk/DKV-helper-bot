const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');
const i18n = require('./i18n');
const config = require('./config');
const { fuelTypes } = require('./consts');

const { parseFrenchHours } = require('./utils/timeParser');

const bot = new Telegraf(TOKEN);
bot.use(session());

const capitalize = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

const getUserLang = (ctx) => 'ru';
const getTxt = (ctx, key) => i18n['ru']?.[key] || `[${key}]`;

bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
        console.log(`=== КЛИК ПО КНОПКЕ === Data: "${ctx.callbackQuery.data}"`);
    }
    return next();
});

const sendMainMenu = async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.location = null;
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
    ctx.session.country = 'FR'; // Временно хардкод страны, пока не перешли к выбору

    // Регулярное выражение для проверки координат (например: 48.8566, 2.3522)
    const geoRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;

    if (geoRegex.test(rawInput)) {
        // ЮЗЕР ВВЕЛ КООРДИНАТЫ
        const [lat, lon] = rawInput.split(',').map(coord => parseFloat(coord.trim()));
        ctx.session.userCoords = { lat, lon };
        ctx.session.location = `${lat.toFixed(4)}, ${lon.toFixed(4)}`; // Для вывода юзеру
    } else {
        // ЮЗЕР ВВЕЛ ГОРОД ТЕКСТОМ
        ctx.session.userCoords = null; // Сбрасываем GPS, так как ищем по городу
        ctx.session.location = capitalize(rawInput);
    }

    const text = getTxt(ctx, 'select_fuel').replace('{city}', ctx.session.location);
    await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('⛽️ Diesel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
        [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')],
        [Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]
    ]));
});

bot.action(/^fuel_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        const fuelKey = ctx.match[0];
        const fuel = fuelTypes[fuelKey];
        const location = ctx.session?.location;
        const hasCoords = !!ctx.session?.userCoords;

        if (!location) return ctx.reply('Ошибка: введите город заново.');

        // ТЕПЕРЬ СТРОГО ИЗ i18n
        const menuText = getTxt(ctx, 'filter_menu_title')
            .replace('{city}', location)
            .replace('{fuel}', fuel.label);

        let keyboard = [];

        if (!hasCoords) {
            // Если только город: сортировка по цене по умолчанию
            keyboard = [
                [
                    Markup.button.callback(getTxt(ctx, 'filter_all'), `filter_all_price_${fuelKey}`),
                    Markup.button.callback(getTxt(ctx, 'filter_open_now'), `filter_open_price_${fuelKey}`)
                ]
            ];
        } else {
            // Если есть GPS: продвинутое меню (Фильтр + Сортировка)
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

        // Добавляем кнопку главного меню в конец
        keyboard.push([Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]);

        await ctx.editMessageText(menuText, Markup.inlineKeyboard(keyboard)).catch(() => { });
    } catch (e) {
        console.error('Ошибка в меню фильтра:', e.message);
    }
});

// --- ПОИСК И РЕЗУЛЬТАТ ---

// --- ПОИСК И РЕЗУЛЬТАТ ---
bot.action(/^filter_(all|open)_(price|dist)_(fuel_.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        const filterType = ctx.match[1]; // all или open
        const sortType = ctx.match[2];   // price или dist
        const fuelKey = ctx.match[3];    // fuel_gazole и т.д.
        const fuel = fuelTypes[fuelKey];

        ctx.session = ctx.session || {};
        const location = ctx.session.location;

        if (!location) return ctx.reply('Ошибка: город не найден в сессии.');

        await ctx.editMessageText(getTxt(ctx, 'searching').replace('{fuel}', fuel.label).replace('{city}', location))
            .catch(() => { });

        let records = [];
        const apiLocation = location.toUpperCase();

        const response = await axios.get(config.FRANCE_API_URL, {
            params: {
                where: `ville LIKE "${apiLocation}*" AND ${fuel.frField} > 0`,
                order_by: `${fuel.frField} ASC`,
                limit: 30
            }
        });

        if (response.data.results) {
            // ВЫВОДИМ В КОНСОЛЬ ВСЕ ПОЛЯ ПЕРВОЙ ЗАПРАВКИ ДЛЯ ДЕБАГА РАСПИСАНИЯ
            if (response.data.results[0]) {
                console.log('=== СТРУКТУРА ПЕРВОЙ ЗАПРАВКИ ===', JSON.stringify(response.data.results[0], null, 2));
            }

            const seenAddresses = new Set();

            // МАППИНГ С СОХРАНЕНИЕМ НОВЫХ ПОЛЕЙ РАСПИСАНИЯ
            records = response.data.results.map(station => ({
                price: station[fuel.frField],
                name: station.nom || '---',
                address: station.adresse || '---',
                city: location,
                horaires: station.horaires,
                horaires_automate_24_24: station.horaires_automate_24_24,
                horaires_jour: station.horaires_jour
            })).filter(station => {
                const addr = station.address.toLowerCase().trim();
                if (seenAddresses.has(addr)) return false;
                seenAddresses.add(addr);
                return true;
            });
        }

        // --- Использование утилиты для фильтра «ОТКРЫТО СЕЙЧАС» ---
        if (filterType === 'open') {
            records = records.filter(station => {
                const hoursStatus = parseFrenchHours(station, 'ru');
                return hoursStatus.includes('24/7');
            });
        }

        if (!records || records.length === 0) {
            const notFoundText = filterType === 'open'
                ? `В городе ${location} сейчас нет открытых АЗС с топливом ${fuel.label}.`
                : getTxt(ctx, 'not_found').replace('{fuel}', fuel.label).replace('{city}', location);

            return ctx.reply(notFoundText, Markup.inlineKeyboard([
                [Markup.button.callback(getTxt(ctx, 'search_again'), 'main_menu')]
            ]));
        }

        records = records.slice(0, config.STATIONS_LIMIT);
        let report = getTxt(ctx, 'top_title').replace('{fuel}', fuel.label).replace('{city}', location) + '\n\n';

        records.forEach((station, index) => {
            const mapUrl = `http://googleusercontent.com/maps.google.com/?q=${encodeURIComponent(station.address + ' ' + station.city)}`;
            const icon = index === 0 ? '🥇' : '📍';

            const timeInfo = parseFrenchHours(station, 'ru');

            report += `${icon} *${station.price}€* — ${station.name}\n🏠 ${station.address}\n${timeInfo}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
        });

        await ctx.replyWithMarkdown(report, Markup.inlineKeyboard([
            [Markup.button.callback(getTxt(ctx, 'search_again'), 'main_menu')]
        ]));

    } catch (error) {
        console.error('Error in search', error.message);
        ctx.reply(getTxt(ctx, 'error'));
    }
});

bot.launch().then(() => console.log('🚀 Бот запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));