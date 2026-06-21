const axios = require('axios');
const { getDistance } = require('./geo');

// Маппинг под бельгийские идентификаторы топлива на Carbu
const BELGIUM_FUEL_MAPPING = {
  'fuel_gazole': 'GO',      // Gazole / Diesel
  'fuel_e10': 'E10',        // Essence SP95-E10
  'fuel_sp98': 'SP98',      // Essence SP98
  'fuel_gplc': 'LPG'        // GPL
};

/**
 * Получение ближайших заправок по Бельгии
 */
const getBelgiumStations = async (lat, lon, fuelKey, radiusKm = 15) => {
  try {
    const targetFuel = BELGIUM_FUEL_MAPPING[fuelKey];
    if (!targetFuel) return [];

    // Быстрый официальный эндпоинт поиска по координатам
    const url = 'https://carbu.com/pages/api/getStations.php';

    const response = await axios.get(url, {
      params: {
        lat: lat,
        lon: lon,
        fuel: targetFuel,
        radius: radiusKm,
        limit: 25
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://carbu.com/belgie/'
      }
    });

    if (!response.data || !Array.isArray(response.data.stations)) {
      return [];
    }

    return response.data.stations.map(station => {
      const sLat = parseFloat(station.lat);
      const sLon = parseFloat(station.lng);
      const distance = getDistance(lat, lon, sLat, sLon);

      return {
        price: parseFloat(station.price).toFixed(2),
        name: station.brand ? ` — ${station.brand}` : ' — АЗС Бельгия',
        address: station.address || '---',
        city: station.city || '',
        distance: distance,
        geom: { lat: sLat, lon: sLon },
        horario: station.hours || '24/7',
        isBelgium: true
      };
    });

  } catch (error) {
    console.error('[Belgium API Error] Ошибка получения данных Бельгии:', error.message);
    return [];
  }
};

module.exports = { getBelgiumStations };