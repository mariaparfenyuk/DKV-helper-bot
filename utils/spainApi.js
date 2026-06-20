const axios = require('axios');
const config = require('../config');
const { getDistance } = require('./geo');

let spainCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 минут

const SPAIN_FUEL_MAPPING = {
  'fuel_gazole': 'Precio Gasoleo A',
  'fuel_e10': 'Precio Gasolina 95 E10',
  'fuel_sp98': 'Precio Gasolina 98 E5'
};

// Функция фонового скачивания данных
const updateSpainCache = async () => {
  try {
    console.log('--- [Spain API] Фоновое обновление базы заправок Испании... ---');
    const response = await axios.get(config.SPAIN_API_URL, { timeout: 15000 });

    if (response.data && response.data.ListaEESSPrecio) {
      spainCache = response.data.ListaEESSPrecio;
      lastFetchTime = Date.now();
      console.log(`--- [Spain API] База успешно обновлена в фоне. Заправок: ${spainCache.length} ---`);
    }
  } catch (error) {
    console.error('[Spain API Error] Не удалось обновить кэш в фоне:', error.message);
  }
};

/**
 * Инициализация фонового обновления при старте бота
 */
const initSpainUpdater = () => {
  // 1. Запускаем первое скачивание немедленно при старте
  updateSpainCache();

  // 2. Ставим таймер на обновление каждые 30 минут
  setInterval(updateSpainCache, CACHE_DURATION);
};

/**
 * Ищет ближайшие заправки в Испании (работает мгновенно из кэша)
 */
const getSpainStations = async (lat, lon, fuelKey, radiusKm = 15) => {
  // Если вдруг кэш пустой (например, сервер только загрузился, а юзер уже жмет кнопку)
  if (!spainCache) {
    await updateSpainCache();
  }

  if (!spainCache) return [];

  const targetFuelField = SPAIN_FUEL_MAPPING[fuelKey];
  if (!targetFuelField) return [];

  const stationsWithDistance = [];

  for (const station of spainCache) {
    const rawPrice = station[targetFuelField];
    if (!rawPrice) continue;

    const price = parseFloat(rawPrice.replace(',', '.'));
    if (isNaN(price) || price <= 0) continue;

    const sLat = parseFloat(station['Latitud'].replace(',', '.'));
    const sLon = parseFloat(station['Longitud (WGS84)'].replace(',', '.'));
    if (isNaN(sLat) || isNaN(sLon)) continue;

    const distance = getDistance(lat, lon, sLat, sLon);

    if (distance <= radiusKm) {
      stationsWithDistance.push({
        price: price,
        name: station['Rótulo'] ? ` — ${station['Rótulo']}` : '',
        address: station['Dirección'] || '---',
        city: station['Municipio'] || '',
        distance: distance,
        geom: { lat: sLat, lon: sLon },
        horario: station['Horario'] || '---',
        isSpain: true
      });
    }
  }

  return stationsWithDistance;
};

module.exports = { getSpainStations, initSpainUpdater };