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
const { getCzechStations } = require('../utils/czechApi'); // Раскомментировали, чтобы не было ReferenceError
const { getBelgiumStations } = require('../utils/belgiumApi');

const handleSearchRequest = async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => { });

    const filterType = ctx.match[1];
    const sortType = ctx.match[2];
    const fuelKey = ctx.match[3];
    const fuel = fuelTypes[fuelKey];
    const location = ctx.session?.location;
    const country = ctx.session?.country || 'FR';

    if (!location) return ctx.replyWithMarkdown(getTxt(ctx, 'error_session_expired'));

    const loadingText = getTxt(ctx, 'searching_fuel').replace('{fuel}', fuel.label);
    await ctx.editMessageText(loadingText).catch(() => { });

    let records = [];
    const seenAddresses = new Set();

    // ==========================================
    // 1. СБОР ДАННЫХ ИЗ API РАЗНЫХ СТРАН
    // ==========================================

    if (country === 'DE') {
      const { lat, lon } = ctx.session.userCoords || { lat: 52.52, lon: 13.40 };
      const deFuelType = fuelKey === 'fuel_gazole' ? 'diesel' :
        fuelKey === 'fuel_e10' ? 'e10' : 'e5';

      const response = await axios.get(config.GERMANY_API_URL, {
        params: {
          lat: lat,
          lng: lon,
          rad: 15,
          type: deFuelType,
          sort: 'price',
          apikey: config.GERMANY_API_KEY
        }
      });

      const validStations = response.data?.stations ? response.data.stations.filter(s => s.price && s.price > 0) : [];

      if (validStations.length === 0) {
        const errorText = getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);
        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = validStations.map(station => ({
        price: station.price,
        name: station.name ? ` — ${station.brand || station.name}` : '',
        address: `${station.street} ${station.streetNumber || ''}`.trim(),
        city: station.place || location,
        distance: station.dist || Infinity,
        geom: { lat: station.lat, lon: station.lng },
        isOpen: station.isOpen,
        isGerman: true,
        isSpain: false,
        isAustria: false,
        isItaly: false,
        isCzech: false,
        isBelgium: false
      }));

    } else if (country === 'ES') {
      const { lat, lon } = ctx.session.userCoords || { lat: 40.4167, lon: -3.7037 };
      const spainStations = await getSpainStations(lat, lon, fuelKey, 15);

      if (spainStations.length === 0) {
        const errorText = getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);
        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = spainStations.map(station => ({
        ...station,
        isOpen: true,
        isGerman: false,
        isSpain: true,
        isAustria: false,
        isItaly: false,
        isCzech: false,
        isBelgium: false
      }));

    } else if (country === 'AT') {
      const { lat, lon } = ctx.session.userCoords || { lat: 48.2082, lon: 16.3738 };
      const austriaStations = await getAustriaStations(lat, lon, fuelKey);

      if (austriaStations.length === 0) {
        const errorText = getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);
        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = austriaStations.map(station => ({
        ...station,
        isGerman: false,
        isSpain: false,
        isAustria: true,
        isItaly: false,
        isCzech: false,
        isBelgium: false
      }));

    } else if (country === 'IT') {
      const { lat, lon } = ctx.session.userCoords || { lat: 41.9028, lon: 12.4964 };
      const italyStations = await getItalyStations(lat, lon, fuelKey, 15);

      if (italyStations.length === 0) {
        const errorText = getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);
        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = italyStations.map(station => ({
        ...station,
        isOpen: true,
        isGerman: false,
        isSpain: false,
        isAustria: false,
        isItaly: true,
        isCzech: false,
        isBelgium: false
      }));

    } else if (country === 'CZ') {
      const { lat, lon } = ctx.session.userCoords || { lat: 50.0755, lon: 14.4378 };
      const czechStations = await getCzechStations(lat, lon, fuelKey, 15);

      if (czechStations.length === 0) {
        const errorText = getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);
        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = czechStations.map(station => ({
        ...station,
        isOpen: true,
        isGerman: false,
        isSpain: false,
        isAustria: false,
        isItaly: false,
        isCzech: true,
        isBelgium: false
      }));

    } else if (country === 'BE') {
      const { lat, lon } = ctx.session.userCoords || { lat: 50.8503, lon: 4.3517 };
      const belgiumStations = await getBelgiumStations(lat, lon, fuelKey, 15);

      if (belgiumStations.length === 0) {
        const errorText = getTxt(ctx, 'error_coords_not_found').replace('{location}', location).replace('{fuel}', fuel.label);
        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = belgiumStations.map(station => ({
        ...station,
        isOpen: true,
        isGerman: false,
        isSpain: false,
        isAustria: false,
        isItaly: false,
        isCzech: false,
        isBelgium: true
      }));

    } else {
      // === ЛОГИКА ДЛЯ ФРАНЦИИ ===
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

        return ctx.replyWithMarkdown(errorText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
      }

      records = response.data.results.map(station => {
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
          horaires_jour: station.horaires_jour,
          isGerman: false,
          isSpain: false,
          isAustria: false,
          isItaly: false,
          isCzech: false,
          isBelgium: false // Добавили корректный дефолт для Франции
        };
      });
    }

    // ==========================================
    // 2. ОБЩАЯ ФИЛЬТРАЦИЯ И СОРТИРОВКА
    // ==========================================

    records = records.filter(station => {
      if (station.isAustria || station.isSpain || station.isItaly || station.isCzech || station.isBelgium) return true;

      const addr = station.address.toLowerCase().trim();
      if (seenAddresses.has(addr)) return false;
      seenAddresses.add(addr);
      return true;
    });

    if (filterType === 'open') {
      records = records.filter(station => {
        if (station.isGerman || station.isAustria) {
          return station.isOpen === true;
        } else if (station.isSpain || station.isItaly || station.isCzech || station.isBelgium) {
          return true;
        } else {
          const hoursStatus = parseFrenchHours(station, 'ru');
          return hoursStatus.includes('24/7') || hoursStatus.toLowerCase().includes('открыто');
        }
      });
    }

    if (records.length === 0) {
      const closedText = getTxt(ctx, 'error_all_stations_closed').replace('{location}', location).replace('{fuel}', fuel.label);
      return ctx.replyWithMarkdown(closedText, Markup.inlineKeyboard([[Markup.button.callback(getTxt(ctx, 'main_menu'), 'main_menu')]]));
    }

    if (sortType === 'dist') {
      records.sort((a, b) => a.distance - b.distance);
    } else {
      records.sort((a, b) => a.price - b.price);
    }

    records = records.slice(0, config.STATIONS_LIMIT);

    // ==========================================
    // 3. ГЕНЕРАЦИЯ И ОТПРАВКА ОТЧЕТА
    // ==========================================
    const reportKey = filterType === 'open' ? 'report_title_open' : 'report_title_all';
    let report = getTxt(ctx, reportKey).replace('{location}', location);

    records.forEach((station, index) => {
      const icon = index === 0 ? '🥇' : '📍';
      const distInfo = station.distance !== Infinity ? ` 🚗 *(${station.distance.toFixed(1)} км)*` : '';

      let timeInfo;
      if (station.isGerman || station.isAustria) {
        timeInfo = station.isOpen ? getTxt(ctx, 'time_24_7') : getTxt(ctx, 'time_closed_today');
      } else if (station.isSpain || station.isItaly || station.isCzech || station.isBelgium) {
        timeInfo = station.horario || '---';
      } else {
        timeInfo = parseFrenchHours(station, 'ru');
      }

      const mapUrl = getMapUrl(ctx, station);
      report += `${icon} *${station.price}€*${distInfo}${station.name}\n🏠 ${station.address}\n🕒 ${timeInfo}\n🚗 [${getTxt(ctx, 'route')}](${mapUrl})\n\n`;
    });

    await ctx.replyWithMarkdown(report, Markup.inlineKeyboard([
      [Markup.button.callback(getTxt(ctx, 'search_again'), 'main_menu')]
    ]));

  } catch (error) {
    await handleUnexpectedError(ctx, error);
  }
};

module.exports = { handleSearchRequest };