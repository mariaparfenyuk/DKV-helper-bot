const axios = require('axios');
const { Markup } = require('telegraf');
const config = require('../config');
const { fuelTypes } = require('../consts');
const { getDistance } = require('../utils/geo');
const { parseFrenchHours } = require('../utils/timeParser');
const { getMapUrl } = require('../utils/maps');
const { handleUnexpectedError } = require('../utils/errors');
const { getTxt } = require('../utils/text');

const handleSearchRequest = async (ctx) => {
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
};

module.exports = { handleSearchRequest };