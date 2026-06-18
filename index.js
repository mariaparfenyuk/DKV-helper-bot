const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');
const i18n = require('./i18n');
const config = require('./config');
const { fuelTypes } = require('./consts');

// Подключаем утилиту для расчета расстояния по формуле гаверсинусов
const { getDistance } = require('./utils/geo');

const bot = new Telegraf(TOKEN);
bot.use(session());

const capitalize = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

const getTxt = (ctx, key) => i18n['ru']?.[key] || `[${key}]`;

// Логирование кликов для отладки в консоли
bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
        console.log(`=== КЛИК ПО КНОПКЕ === Data: "${ctx.callbackQuery.data}"`);
    }
    return next();
});

const sendMainMenu = async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.location = null;
    ctx.session.userCoords = null; // Сбрасываем старый GPS при выходе в главное меню
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

// Обработка ввода (Распознаем: Город текстом или GPS-координаты)
bot.on('text', async (ctx) => {
    const rawInput = ctx.message.text.trim();
    if (rawInput.startsWith('/')) return;

    ctx.session = ctx.session || {};
    ctx.session.country = 'FR';

    // Регулярное выражение для проверки координат (например: 48.8566, 2.3522)
    const geoRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;

    if (geoRegex.test(rawInput)) {
        // ЮЗЕР ВВЕЛ КООРДИНАТЫ
        const [lat, lon] = rawInput.split(',').map(coord => parseFloat(coord.trim()));
        ctx.session.userCoords = { lat, lon };
        ctx.session.location = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    } else {
        // ЮЗЕР ВВЕЛ ГОРОД ТЕКСТОМ
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

// Меню выбора фильтров и сортировки
bot.action(/^fuel_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        const fuelKey = ctx.match[0]; // Напр. fuel_gazole
        const fuel = fuelTypes[fuelKey];
        const location = ctx.session?.location;
        const hasCoords = !!ctx.session?.userCoords;

        if (!location) return ctx.reply('Ошибка: введите город заново.');

        const menuText = getTxt(ctx, 'filter_menu_title')
            .replace('{city}', location)
            .replace('{fuel}', fuel.label);

        let keyboard = [];

        if (!hasCoords) {
            // Если введен только город — показываем стандартные кнопки (Все / Открытые)
            keyboard = [
                [
                    Markup.button.callback(getTxt(ctx, 'filter_all'), `filter_all_price_${fuelKey}`),
                    Markup.button.callback(getTxt(ctx, 'filter_open_now'), `filter_open_price_${fuelKey}`)
                ]
            ];
        } else {
            // Если есть координаты — даем полноценный мультиязычный выбор сортировки
            keyboard = [
                [
                    Markup.button.callback(getTxt(ctx, 'filter_all_price'), `filter_all_price_${fuelKey}`),
                    Markup.button.callback(getTxt(ctx, 'filter_all_dist'), `filter_all_dist_${fuelKey}`)
                ]
            ];
        }

        keyboard.push([Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]);

        await ctx.editMessageText(menuText, Markup.inlineKeyboard(keyboard)).catch(() => { });
    } catch (e) {
        console.error('Ошибка в меню фильтра:', e.message);
    }
});

// --- ПОИСК И РЕЗУЛЬТАТ ---
bot.action(/^filter_(all|open)_(price|dist)_(fuel_.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });

        const filterType = ctx.match[1]; // all или open
        const sortType = ctx.match[2];   // price или dist
        const fuelKey = ctx.match[3];    // fuel_...
        const fuel = fuelTypes[fuelKey];
        const location = ctx.session?.location;

        if (!location) return ctx.reply('Ошибка: локация не найдена.');
        if (!ctx.session?.userCoords) return ctx.reply('Ошибка: этот тест только для КООРДИНАТ!');

        await ctx.editMessageText(`🔍 Ищу топливо ${fuel.label}...`).catch(() => { });

        const { lat, lon } = ctx.session.userCoords;

        // Делаем гео-запрос к API Франции (радиус 30км, сортировка по цене по умолчанию)
        const response = await axios.get(config.FRANCE_API_URL, {
            params: {
                where: `within_distance(geom, geom'POINT(${lon} ${lat})', 30km) AND ${fuel.frField} > 0`,
                order_by: `${fuel.frField} ASC`,
                limit: 30 // Берем с запасом, чтобы было из чего выбрать ближайшие
            }
        });

        if (!response.data?.results || response.data.results.length === 0) {
            return ctx.reply('API вернул 0 заправок в этом радиусе.');
        }

        const seenAddresses = new Set();

        // 1. Маппим результаты и высчитываем реальное расстояние в километрах до каждой АЗС
        let records = response.data.results.map(station => {
            let distance = Infinity;
            if (station.geom) {
                distance = getDistance(lat, lon, station.geom.lat, station.geom.lon);
            }
            return {
                price: station[fuel.frField],
                name: station.nom || '---',
                address: station.adresse || '---',
                distance: distance
            };
        }).filter(station => {
            const addr = station.address.toLowerCase().trim();
            if (seenAddresses.has(addr)) return false;
            seenAddresses.add(addr);
            return true;
        });

        // 2. Если юзер выбрал сортировку по дистанции — перестраиваем массив по км
        if (sortType === 'dist') {
            records.sort((a, b) => a.distance - b.distance);
        }

        // Обрезаем массив до лимита из конфига
        records = records.slice(0, config.STATIONS_LIMIT);

        // Формируем заголовок отчета в зависимости от типа сортировки
        let report = sortType === 'dist'
            ? `🚗 *Ближайшие АЗС рядом с вами:* \n\n`
            : `💰 *Самые дешевые АЗС рядом с вами:* \n\n`;

        records.forEach((station, index) => {
            const icon = index === 0 ? '🥇' : '📍';
            const distInfo = station.distance !== Infinity ? ` 🚗 *(${station.distance} км)*` : '';
            const mapUrl = `http://googleusercontent.com/maps.google.com/?q=${encodeURIComponent(station.address)}`;

            report += `${icon} *${station.price}€*${distInfo} — ${station.name}\n🏠 ${station.address}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
        });

        await ctx.replyWithMarkdown(report, Markup.inlineKeyboard([
            [Markup.button.callback(getTxt(ctx, 'search_again'), 'main_menu')]
        ]));

    } catch (error) {
        console.error('💥 Ошибка в гео-поиске:', error.message);
        ctx.reply('Произошла ошибка при запросе к API. Проверьте консоль.');
    }
});

bot.launch().then(() => console.log('🚀 Бот запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));