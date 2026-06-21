const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getDistance } = require('./geo');

let italyCache = null;
const CACHE_FILE = path.join(__dirname, '../italy_cache.json');
const TIME_4_HOURS = 4 * 60 * 60 * 1000;

// Новые актуальные эндпоинты экспорта MIMIT
const STATIONS_URL = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
const PRICES_URL = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';

const ITALY_FUEL_MAPPING = {
  'fuel_gazole': 'Gasolio',
  'fuel_e10': 'Benzina',
  'fuel_sp98': 'Benzina Speciale',
  'fuel_gplc': 'GPL'
};

/**
 * Исправленный парсер под новый разделитель "|" (вертикальная черта)
 */
const parseCSV = (text) => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  // Теперь делим строки по вертикальной черте |
  return lines.map(line => line.split('|'));
};

const updateItalyCache = async () => {
  try {
    // Проверяем локальный файл кэша Италии
    if (fs.existsSync(CACHE_FILE)) {
      const stats = fs.statSync(CACHE_FILE);
      const age = Date.now() - stats.mtimeMs;

      if (age < TIME_4_HOURS) {
        console.log('--- [Italy API] Найдена свежая копия Италии на диске. Загружаем... ---');
        italyCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`--- [Italy API] Успешно загружено из файла. Заправок: ${italyCache.length} ---`);
        return;
      }
    }

    console.log('--- [Italy API] Скачивание баз данных Италии из сети... ---');
    const stationsRes = await axios.get(STATIONS_URL, { timeout: 25000 });
    const pricesRes = await axios.get(PRICES_URL, { timeout: 25000 });

    const rawStations = parseCSV(stationsRes.data);
    const rawPrices = parseCSV(pricesRes.data);

    if (rawStations.length > 0) rawStations.shift();
    if (rawPrices.length > 0) rawPrices.shift();

    // Структура АЗС: idimpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine
    const stationsMap = new Map();
    for (const row of rawStations) {
      if (row.length < 10) continue;
      stationsMap.set(row[0], {
        brand: row[2] || 'Independent',
        address: row[5] || '---',
        city: row[6] || '',
        lat: parseFloat(row[8]),
        lon: parseFloat(row[9])
      });
    }

    // Структура цен: idimpianto|descCarburante|prezzo|isSelf
    const stationsWithPrices = new Map();
    for (const row of rawPrices) {
      if (row.length < 4) continue;
      const id = row[0];
      const fuelName = row[1];
      const price = parseFloat(row[2]);
      const isSelf = row[3] === '1';

      const stationInfo = stationsMap.get(id);
      if (!stationInfo || isNaN(stationInfo.lat) || isNaN(stationInfo.lon) || isNaN(price)) continue;

      if (!stationsWithPrices.has(id)) {
        stationsWithPrices.set(id, {
          id,
          brand: stationInfo.brand,
          address: stationInfo.address,
          city: stationInfo.city,
          lat: stationInfo.lat,
          lon: stationInfo.lon,
          prices: {}
        });
      }

      const currentStation = stationsWithPrices.get(id);
      if (!currentStation.prices[fuelName] || isSelf) {
        currentStation.prices[fuelName] = { price, serviceType: isSelf ? 'Self' : 'Servito' };
      }
    }

    italyCache = Array.from(stationsWithPrices.values());

    // Пишем на диск для экономии трафика
    fs.writeFileSync(CACHE_FILE, JSON.stringify(italyCache), 'utf8');
    console.log(`--- [Italy API] База Италии сохранена на диск. Активных АЗС: ${italyCache.length} ---`);

  } catch (error) {
    console.error('[Italy API Error] Ошибка сбора базы Италии:', error.message);
    if (!italyCache && fs.existsSync(CACHE_FILE)) {
      italyCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log('--- [Italy API] Загружен аварийный старый кэш Италии с диска. ---');
    }
  }
};

const initItalyUpdater = () => {
  updateItalyCache();
  setInterval(updateItalyCache, TIME_4_HOURS);
};

const getItalyStations = async (lat, lon, fuelKey, radiusKm = 15) => {
  if (!italyCache) await updateItalyCache();
  if (!italyCache) return [];

  const targetFuelName = ITALY_FUEL_MAPPING[fuelKey];
  if (!targetFuelName) return [];

  const result = [];
  for (const station of italyCache) {
    const fuelData = station.prices[targetFuelName];
    if (!fuelData) continue;

    const distance = getDistance(lat, lon, station.lat, station.lon);
    if (distance <= radiusKm) {
      result.push({
        price: fuelData.price,
        name: station.brand ? ` — ${station.brand}` : '',
        address: station.address,
        city: station.city,
        distance: distance,
        geom: { lat: station.lat, lon: station.lon },
        horario: `Modo: ${fuelData.serviceType}`,
        isItaly: true
      });
    }
  }
  return result;
};

module.exports = { getItalyStations, initItalyUpdater };