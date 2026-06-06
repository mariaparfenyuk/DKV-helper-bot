const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const { TOKEN } = require('./token');
const i18n = require('./i18n');
const config = require('./config');

const bot = new Telegraf(TOKEN);
bot.use(session());

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
    'fuel_gazole': { label: 'Diesel', frField: 'gazole_prix', deField: 'diesel', esField: 'Precio Gasoleo A' },
    'fuel_e10': { label: 'E10', frField: 'e10_prix', deField: 'e10', esField: 'Precio Gasolina 95 E10' },
    'fuel_sp98': { label: 'SP98', frField: 'sp98_prix', deField: 'e5', esField: 'Precio Gasolina 98 E5' },
    'fuel_gplc': { label: 'GPL', frField: 'gplc_prix', deField: 'gashigh', esField: 'Precio Gases Licuados del Petróleo' }
};

const getLangKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🇷🇺 Русский', 'set_lang_ru'), Markup.button.callback('🇺🇦 Українська', 'set_lang_uk')],
        [Markup.button.callback('🇵🇱 Polski', 'set_lang_pl'), Markup.button.callback('🇫🇷 Français', 'set_lang_fr')],
        [Markup.button.callback('🇬🇧 English', 'set_lang_en')]
    ]);
};

const getCountryKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🇫🇷 France', 'set_country_FR'), Markup.button.callback('🇪🇸 España', 'set_country_ES')],
        [Markup.button.callback('🇩🇪 Deutschland', 'set_country_DE')]
    ]);
};

// --- КОМАНДЫ ---

bot.start(async (ctx) => {
    ctx.session = ctx.session || {};
    const tgLang = ctx.from?.language_code;

    if (!SUPPORTED_LANGS.includes(tgLang)) {
        ctx.session.lang = 'en';
        await ctx.reply('👋 Hello! Please select your language:', mainKeyboard);
        return ctx.reply('Language:', getLangKeyboard());
    }

    ctx.session.lang = tgLang;
    await ctx.reply(getTxt(ctx, 'welcome'), mainKeyboard);
    return ctx.reply('Выберите страну / Select country:', getCountryKeyboard());
});

bot.help((ctx) => {
    ctx.replyWithMarkdown(getTxt(ctx, 'help'), mainKeyboard);
});

bot.command('lang', (ctx) => {
    ctx.reply(getTxt(ctx, 'choose_language'), getLangKeyboard());
});

bot.action(/set_lang_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session = ctx.session || {};
    ctx.session.lang = ctx.match[1];

    await ctx.reply('Country / Страна:', getCountryKeyboard());
});

// Обработка выбора страны (Без хардкода, полностью на i18n)
bot.action(/set_country_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session = ctx.session || {};
    const selectedCountry = ctx.match[1];
    ctx.session.country = selectedCountry;

    const translationKey = `country_chosen_${selectedCountry}`;
    await ctx.editMessageText(getTxt(ctx, translationKey));
});

// --- ЛОГИКА ВВОДА ГОРОДА ---

bot.on('text', async (ctx) => {
    const userInput = ctx.message.text.trim().toUpperCase();
    if (userInput.startsWith('/')) return;

    ctx.session = ctx.session || {};

    if (!ctx.session.country) {
        return ctx.reply('Сначала выберите страну:', getCountryKeyboard());
    }

    ctx.session.location = userInput;

    const text = getTxt(ctx, 'select_fuel').replace('{city}', userInput);
    await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('⛽️ Diesel', 'fuel_gazole'), Markup.button.callback('🔹 E10', 'fuel_e10')],
        [Markup.button.callback('🔹 SP98', 'fuel_sp98'), Markup.button.callback('💨 GPL', 'fuel_gplc')]
    ]));
});

// --- ПРОМЕЖУТОЧНЫЙ ШАГ: ВЫБОР ФИЛЬТРА ---
bot.action(/fuel_(.+)/, async (ctx) => {
    try {
        // Безопасно тушим часики анимации на кнопке
        await ctx.answerCbQuery().catch(() => { });

        const fuelKey = ctx.match[0];
        const fuel = fuelTypes[fuelKey];
        const location = ctx.session?.location;

        if (!location) return ctx.reply(getTxt(ctx, 'welcome'));

        const menuText = `📍 ${location} | ⛽️ ${fuel.label}\n\n${getTxt(ctx, 'choose_language') === 'Wybierz język:' ? 'Wybierz filtr:' : 'Выберите фильтр:'}`;

        // Защита от дубликатов: если текст совпадает, Telegram не выдаст ошибку, catch её поймает
        await ctx.editMessageText(menuText, Markup.inlineKeyboard([
            [
                Markup.button.callback(getTxt(ctx, 'filter_all'), `filter_all_${fuelKey}`),
                Markup.button.callback(getTxt(ctx, 'filter_open_now'), `filter_open_${fuelKey}`)
            ]
        ])).catch(err => {
            if (!err.message.includes('message is not modified')) {
                console.error('Ошибка изменения сообщения:', err.message);
            }
        });
    } catch (e) {
        console.error('Ошибка в экшене выбора топлива:', e.message);
    }
});

// --- ПОИСК, ФИЛЬТРАЦИЯ И ОТВЕТ ---

bot.action(/filter_(all|open)_(fuel_.+)/, async (ctx) => {
    try {
        // Гасим часики анимации. Если запрос устарел — просто ловим ошибку и идем дальше
        await ctx.answerCbQuery().catch(() => { });

        const filterType = ctx.match[1];
        const fuelKey = ctx.match[2];
        const fuel = fuelTypes[fuelKey];

        ctx.session = ctx.session || {};
        const location = ctx.session.location;
        const country = ctx.session.country;

        if (!location || !country) return ctx.reply(getTxt(ctx, 'welcome'));

        // Меняем текст на "Поиск...", игнорируя ошибку дубликата
        await ctx.editMessageText(getTxt(ctx, 'searching').replace('{fuel}', fuel.label).replace('{city}', location))
            .catch(() => { });

        let records = [];


        // 1. ЛОГИКА ФРАНЦИИ
        if (country === 'FR') {
            const response = await axios.get(config.FRANCE_API_URL, {
                params: {
                    where: `ville LIKE "${location}*" AND ${fuel.frField} > 0`,
                    order_by: `${fuel.frField} ASC`,
                    limit: 30
                }
            });

            if (response.data.results) {
                const seenAddresses = new Set();
                records = response.data.results.map(station => ({
                    price: station[fuel.frField],
                    name: station.nom || '---',
                    address: station.adresse || '---',
                    city: location,
                    horaires: station.horaires
                })).filter(station => {
                    const addr = station.address.toLowerCase().trim();
                    if (seenAddresses.has(addr)) return false;
                    seenAddresses.add(addr);
                    return true;
                });
            }
        }
        // 2. ЛОГИКА ИСПАНИИ
        else if (country === 'ES') {
            const response = await axios.get(config.SPAIN_API_URL);
            const allStations = response.data.ListaEESSPrecio;

            if (allStations) {
                const seenAddresses = new Set();

                records = allStations
                    .filter(station => {
                        const cityMatch = station['Municipio']?.toUpperCase().includes(location);
                        const rawPrice = station[fuel.esField];
                        if (!rawPrice) return false;

                        const priceNum = parseFloat(rawPrice.replace(',', '.'));
                        return cityMatch && priceNum > 0;
                    })
                    .map(station => {
                        const priceNum = parseFloat(station[fuel.esField].replace(',', '.'));
                        return {
                            price: priceNum,
                            name: station['Rótulo'] || '---',
                            address: station['Dirección'] || '---',
                            city: station['Municipio'],
                            horario: station['Horario']
                        };
                    })
                    .sort((a, b) => a.price - b.price)
                    .filter(station => {
                        const addr = station.address.toLowerCase().trim();
                        if (seenAddresses.has(addr)) return false;
                        seenAddresses.add(addr);
                        return true;
                    });
            }
        }
        // 3. ЛОГИКА ГЕРМАНИИ
        else if (country === 'DE') {
            let lat = 52.5200, lng = 13.4050;

            const response = await axios.get(config.GERMANY_API_URL, {
                params: {
                    lat: lat,
                    lng: lng,
                    rad: 10,
                    type: fuel.deField === 'diesel' ? 'diesel' : 'e10',
                    apikey: config.GERMANY_API_KEY,
                    sort: 'price'
                }
            });

            if (response.data.stations) {
                records = response.data.stations.map(station => ({
                    price: station.price,
                    name: station.name || '---',
                    address: `${station.street} ${station.houseNumber || ''}, ${station.postCode} ${station.place}`,
                    city: station.place
                }));
            }
        }

        // --- ПРИМЕНЕНИЕ ФИЛЬТРА «ОТКРЫТО СЕЙЧАС» ---
        if (filterType === 'open') {
            await ctx.reply('⏳ Заглушка фильтра: На следующем шаге мы научим бота читать графики АЗС.');
        }

        // --- ВЫВОД РЕЗУЛЬТАТОВ ---
        if (!records || records.length === 0) {
            return ctx.reply(getTxt(ctx, 'not_found').replace('{fuel}', fuel.label).replace('{city}', location));
        }

        records = records.slice(0, config.STATIONS_LIMIT);

        let report = getTxt(ctx, 'top_title').replace('{fuel}', fuel.label).replace('{city}', location) + '\n\n';

        records.forEach((station, index) => {
            const mapUrl = `http://googleusercontent.com/maps.google.com/?q=${encodeURIComponent(station.address + ' ' + station.city)}`;
            const icon = index === 0 ? '🥇' : '📍';
            report += `${icon} *${station.price}€* — ${station.name}\n🏠 ${station.address}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
        });

        await ctx.replyWithMarkdown(report);

    } catch (error) {
        console.error('Ошибка внутри обработчика фильтра:', error.message);
        ctx.reply(getTxt(ctx, 'error'));
    }
});

bot.launch().then(() => console.log('✅ Бот запущен с поддержкой FR, ES и DE (и шагом фильтрации)!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));