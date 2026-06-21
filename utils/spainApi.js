const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDistance } = require('./geo');

let spainCache = null;
const CACHE_FILE = path.join(__dirname, '../spain_cache.json');
const TIME_4_HOURS = 4 * 60 * 60 * 1000; // Порог свежести кэша на диске

const SPAIN_FUEL_MAPPING = {
  'fuel_gazole': 'Precio Gasoleo A',
  'fuel_e10': 'Precio Gasolina 95 E10',
  'fuel_sp98': 'Precio Gasolina 98 E5'
};

const updateSpainCache = async () => {
  try {
    // Проверяем локальный файл перед тем как лезть в сеть
    if (fs.existsSync(CACHE_FILE)) {
      const stats = fs.statSync(CACHE_FILE);
      const age = Date.now() - stats.mtimeMs;

      if (age < TIME_4_HOURS) {
        console.log('--- [Spain API] Найдена свежая локальная копия на диске. Загружаем... ---');
        const rawData = fs.readFileSync(CACHE_FILE, 'utf8');
        spainCache = JSON.parse(rawData);
        console.log(`--- [Spain API] Успешно загружено из файла. Заправок: ${spainCache.length} ---`);
        return;
      }
    }

    // Если файла нет или он старый — качаем из сети
    console.log('--- [Spain API] Локальный кэш устарел. Скачиваем базу Испании из сети... ---');
    const response = await axios.get(config.SPAIN_API_URL, { timeout: 25000 });

    if (response.data && response.data.ListaEESSPrecio) {
      spainCache = response.data.ListaEESSPrecio;

      // Сохраняем на диск для следующих рестартов
      fs.writeFileSync(CACHE_FILE, JSON.stringify(spainCache), 'utf8');
      console.log(`--- [Spain API] База скачана из сети и сохранена на диск. Заправок: ${spainCache.length} ---`);
    }
  } catch (error) {
    console.error('[Spain API Error] Ошибка кэширования Испании:', error.message);
    // Фолбэк: если сеть упала, но есть хоть какой-то старый файл — берем его
    if (!spainCache && fs.existsSync(CACHE_FILE)) {
      spainCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log('--- [Spain API] Сеть недоступна. Загружен аварийный старый кэш с диска. ---');
    }
  }
};

const initSpainUpdater = () => {
  updateSpainCache();
  setInterval(updateSpainCache, TIME_4_HOURS);
};

const getSpainStations = async (lat, lon, fuelKey, radiusKm = 15) => {
  if (!spainCache) await updateSpainCache();
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