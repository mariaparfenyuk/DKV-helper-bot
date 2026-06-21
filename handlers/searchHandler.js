const axios = require('axios');
const { Markup } = require('telegraf');
const config = require('../config');
const { fuelTypes } = require('../consts');
const { getDistance } = require('../utils/geo');
const { parseFrenchHours } = require('../utils/timeParser');
const { getMapUrl } = require('../utils/maps');
const { handleUnexpectedError } = require('../utils/errors');
const { getTxt } = require('../utils/text');
const { getSpainStations } = require('../utils/spainApi');
const { getAustriaStations } = require('../utils/austriaApi');
const { getItalyStations } = require('../utils/italyApi');
const { getLuxembourgStations } = require('../utils/luxembourgApi');

/**
 * Стратегии сборщиков данных для каждой страны.
 * Приводят разношерстные ответы внешних API к единому внутреннему формату АЗС.
 */
const countryFetchers = {
  DE: async (ctx, fuelKey, location) => {
    const { lat, lon } = ctx.session.userCoords || { lat: 52.52, lon: 13.40 };
    const deFuelType = fuelKey === 'fuel_gazole' ? 'diesel' : fuelKey === 'fuel_e10' ? 'e10' : 'e5';

    const response = await axios.get(config.GERMANY_API_URL, {
      params: { lat, lng: lon, rad: 15, type: deFuelType, sort: 'price', apikey: config.GERMANY_API_KEY }
    });

    const validStations = response.data?.stations?.filter(s => s.price && s.price > 0) || [];
    return validStations.map(s => ({
      price: s.price,
      name: s.name ? ` — ${s.brand || s.name}` : '',
      address: `${s.street} ${s.streetNumber || ''}`.trim(),
      city: s.place || location,
      distance: s.dist || Infinity,
      geom: { lat: s.lat, lon: s.lng },
      isOpen: s.isOpen,
      isGerman: true
    }));
  },

  ES: async (ctx, fuelKey) => {
    const { lat, lon } = ctx.session.userCoords || { lat: 40.4167, lon: -3.7037 };
    const stations = await getSpainStations(lat, lon, fuelKey, 15);
    return stations.map(s => ({ ...s, isOpen: true }));
  },

  AT: async (ctx, fuelKey) => {
    const { lat, lon } = ctx.session.userCoords || { lat: 48.2082, lon: 16.3738 };
    return await getAustriaStations(lat, lon, fuelKey);
  },

  IT: async (ctx, fuelKey) => {
    const { lat, lon } = ctx.session.userCoords || { lat: 41.9028, lon: 12.4964 };
    const stations = await getItalyStations(lat, lon, fuelKey, 15);
    return stations.map(s => ({ ...s, isOpen: true }));
  },

  LU: async (ctx, fuelKey) => {
    const { lat, lon } = ctx.session.userCoords || { lat: 49.6116, lon: 6.1319 };
    const stations = await getLuxembourgStations(lat, lon, fuelKey, 30);
    return stations.map(s => ({ ...s, isOpen: true }));
  },

  FR: async (ctx, fuelKey, location, fuel) => {
    let response;
    if (ctx.session?.userCoords) {
      const { lat, lon } = ctx.session.userCoords;
      response = await axios.get(config.FRANCE_API_URL, {
        params: {
          where: `within_distance(geom, geom'POINT(${lon} ${lat})', 30km) AND ${fuel.frField} > 0`,
          order_by: `${fuel.frField} ASC`, limit: 40
        }
      });
    } else {
      response = await axios.get(config.FRANCE_API_URL, {
        params: {
          where: `ville LIKE "${location.toUpperCase()}*" AND ${fuel.frField} > 0`,
          order_by: `${fuel.frField} ASC`, limit: 40
        }
      });
    }

    const results = response.data?.results || [];
    return results.map(s => ({
      price: s[fuel.frField],
      name: s.nom ? ` — ${s.nom}` : '',
      address: s.adresse || '---',
      city: s.ville || location,
      distance: ctx.session?.userCoords && s.geom ? getDistance(ctx.session.userCoords.lat, ctx.session.userCoords.lon, s.geom.lat, s.geom.lon) : Infinity,
      geom: s.geom,
      horaires: s.horaires,
      horaires_automate_24_24: s.horaires_automate_24_24,
      horaires_jour: s.horaires_jour,
      isFrance: true
    }));
  }
};

/**
 * Универсальный хелпер определения статуса работы АЗС
 */
const checkStationOpenStatus = (station) => {
  if (station.isGerman || station.isAustria) {
    return station.isOpen === true;
  }
  if (station.isFrance) {
    const hoursStatus = parseFrenchHours(station, 'ru');
    return hoursStatus.includes('24/7') || hoursStatus.toLowerCase().includes('открыто');
  }
  return true; // Для ES, IT, LU по умолчанию считаем открытыми (госреестры активных точек)
};

/**
 * Универсальный хелпер форматирования строки времени работы
 */
const formatTimeInfo = (ctx, station) => {
  if (station.isGerman || station.isAustria) {
    return station.isOpen ? getTxt(ctx, 'time_24_7') : getTxt(ctx, 'time_closed_today');
  }
  if (station.isFrance) {
    return parseFrenchHours(station, 'ru');
  }
  return station.horario || '---'; // Для ES, IT, LU
};

// ==========================================
// ОСНОВНОЙ ОБРАБОТЧИК ЗАПРОСА
// ==========================================
const handleSearchRequest = async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => { });

    const [, filterType, sortType, fuelKey] = ctx.match;
    const fuel = fuelTypes[fuelKey];
    const location = ctx.session?.location;
    const country = ctx.session?.country || 'FR';

    if (!location) return ctx.replyWithMarkdown(getTxt(ctx, 'error_session_expired'));

    const loadingText = getTxt(ctx, 'searching_fuel').replace('{fuel}', fuel.label);
    await ctx.editMessageText(loadingText).catch(() => { });

    // 1. Сбор данных через выбранную стратегию страны
    const fetcher = countryFetchers[country] || countryFetchers.FR;
    let records = await fetcher(ctx, fuelKey, location, fuel);

    if (records.length === 0) {
      const errorText = (country === 'FR' && !ctx.session?.userCoords)
        ? getTxt(ctx, 'error_city_not_found').replace('{location}', location)
        : getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);

      return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
    }

    // 2. Фильтрация дубликатов по адресу (кроме API со встроенным уникальным ID)
    const seenAddresses = new Set();
    records = records.filter(s => {
      if (s.isAustria || s.isSpain || s.isItaly || s.isLuxembourg) return true;
      const addr = s.address.toLowerCase().trim();
      if (seenAddresses.has(addr)) return false;
      seenAddresses.add(addr);
      return true;
    });

    // 3. Фильтрация «Только открытые»
    if (filterType === 'open') {
      records = records.filter(checkStationOpenStatus);
    }

    if (records.length === 0) {
      const closedText = getTxt(ctx, 'error_all_stations_closed').replace('{location}', location).replace('{fuel}', fuel.label);
      return ctx.replyWithMarkdown(closedText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
    }

    // 4. Сортировка (Цена / Дистанция)
    records.sort((a, b) => sortType === 'dist' ? a.distance - b.distance : a.price - b.price);
    records = records.slice(0, config.STATIONS_LIMIT);

    // 5. Генерация отчета
    const reportKey = filterType === 'open' ? 'report_title_open' : 'report_title_all';
    let report = getTxt(ctx, reportKey).replace('{location}', location);

    records.forEach((station, index) => {
      const icon = index === 0 ? '🥇' : '📍';
      const distInfo = station.distance !== Infinity ? ` 🚗 *(${station.distance.toFixed(1)} км)*` : '';
      const timeInfo = formatTimeInfo(ctx, station);
      const mapUrl = getMapUrl(ctx, station);

      report += `${icon} *${Number(station.price).toFixed(2)}€*${distInfo}${station.name}\n🏠 ${station.address}\n🕒 ${timeInfo}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
    });

    await ctx.replyWithMarkdown(report, Markup.inlineKeyboard([
      [Markup.button.callback(getTxt(ctx, 'search_again'), 'main_menu')]
    ]));

  } catch (error) {
    await handleUnexpectedError(ctx, error);
  }
};

module.exports = { handleSearchRequest };