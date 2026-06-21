const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getDistance } = require('./geo');

let czechCache = null;
const CACHE_FILE = path.join(__dirname, '../czech_cache.json');
const TIME_4_HOURS = 4 * 60 * 60 * 1000;

// Используем стабильное CDN-зеркало государственного реестра Чехии
const CZECH_API_URL = 'https://raw.githubusercontent.com/ceproas/fuel-prices-api/main/stations.json';

const CZECH_FUEL_MAPPING = {
  'fuel_gazole': 'Nafta',
  'fuel_e10': 'Natural 95',
  'fuel_sp98': 'Natural 98',
  'fuel_gplc': 'LPG'
};

const updateCzechCache = async () => {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const stats = fs.statSync(CACHE_FILE);
      const age = Date.now() - stats.mtimeMs;

      if (age < TIME_4_HOURS) {
        console.log('--- [Czech API] Найдена свежая копия Чехии на диске. Загружаем... ---');
        czechCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`--- [Czech API] Успешно загружено из файла. Заправок: ${czechCache.length} ---`);
        return;
      }
    }

    console.log('--- [Czech API] Скачивание базы данных Чехии из сети... ---');
    // Увеличиваем таймаут до 35 секунд на случай медленного ответа сервера
    const response = await axios.get(CZECH_API_URL, { timeout: 35000 });

    if (response.data && Array.isArray(response.data)) {
      czechCache = response.data;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(czechCache), 'utf8');
      console.log(`--- [Czech API] База Чехии сохранена на диск. Всего АЗС: ${czechCache.length} ---`);
    } else if (response.data && response.data.stations) {
      // Фолбэк на случай, если структура объекта изменится на { stations: [...] }
      czechCache = response.data.stations;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(czechCache), 'utf8');
      console.log(`--- [Czech API] База Чехии сохранена на диск. Всего АЗС: ${czechCache.length} ---`);
    }
  } catch (error) {
    console.error('[Czech API Error] Ошибка сбора базы Чехии:', error.message);
    if (!czechCache && fs.existsSync(CACHE_FILE)) {
      czechCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log('--- [Czech API] Загружен аварийный старый кэш Чехии с диска. ---');
    }
  }
};

const initCzechUpdater = () => {
  updateCzechCache();
  setInterval(updateCzechCache, TIME_4_HOURS);
};

const getCzechStations = async (lat, lon, fuelKey, radiusKm = 15) => {
  if (!czechCache) await updateCzechCache();
  if (!czechCache) return [];

  const targetFuelName = CZECH_FUEL_MAPPING[fuelKey];
  if (!targetFuelName) return [];

  const result = [];

  for (const station of czechCache) {
    const fuelData = station.fuels ? station.fuels.find(f => f.name === targetFuelName) : null;
    if (!fuelData || !fuelData.price || fuelData.price <= 0) continue;

    const sLat = parseFloat(station.latitude);
    const sLon = parseFloat(station.longitude);
    if (isNaN(sLat) || isNaN(sLon)) continue;

    const distance = getDistance(lat, lon, sLat, sLon);

    if (distance <= radiusKm) {
      // Средний курс кроны к евро (~25 CZK за 1 EUR)
      const priceInEur = (fuelData.price / 25.1).toFixed(2);

      result.push({
        price: priceInEur,
        name: station.brand ? ` — ${station.brand}` : ' — Čepro',
        address: station.address || '---',
        city: station.city || '',
        distance: distance,
        geom: { lat: sLat, lon: sLon },
        horario: station.openingHours || '24/7',
        isCzech: true
      });
    }
  }

  return result;
};

module.exports = { getCzechStations, initCzechUpdater };