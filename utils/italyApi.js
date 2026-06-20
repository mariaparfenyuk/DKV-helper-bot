const axios = require('axios');
const { getDistance } = require('./geo');

let italyCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // Обновляем раз в час

// Ссылки на официальные CSV-данные министерства Италии
const STATIONS_URL = 'https://www.mise.gov.it/images/stories/carburanti/anagrafica_impianti_attivi.csv';
const PRICES_URL = 'https://www.mise.gov.it/images/stories/carburanti/prezzo_alle_vendite.csv';

// Маппинг типов топлива на итальянские названия в их базе
const ITALY_FUEL_MAPPING = {
  'fuel_gazole': 'Gasolio',      // Дизель
  'fuel_e10': 'Benzina',         // Бензин (в Италии E10/E5 часто идет как стандартная Benzina)
  'fuel_sp98': 'Benzina Speciale', // Премиум бензин / 98-й
  'fuel_gplc': 'GPL'             // Газ GPL
};

/**
 * Простая и быстрая функция для парсинга CSV строк без тяжелых библиотек
 */
const parseCSV = (text) => {
  // Разделяем по строкам, убираем пустые
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  // Итальянские файлы используют точку с запятой (;) в качестве разделителя
  return lines.map(line => line.split(';'));
};

const updateItalyCache = async () => {
  try {
    console.log('--- [Italy API] Скачивание баз данных Италии (Файл 1: АЗС)... ---');
    const stationsRes = await axios.get(STATIONS_URL, { timeout: 20000 });

    console.log('--- [Italy API] Скачивание баз данных Италии (Файл 2: Цены)... ---');
    const pricesRes = await axios.get(PRICES_URL, { timeout: 20000 });

    const rawStations = parseCSV(stationsRes.data);
    const rawPrices = parseCSV(pricesRes.data);

    // Пропускаем первую строчку заголовков в CSV
    if (rawStations.length > 0) rawStations.shift();
    if (rawPrices.length > 0) rawPrices.shift();

    // 1. Индексируем станции в Map для мгновенного поиска по idImpianto
    // Структура строки АЗС: idImpianto;Gestore;Bandiera;Tipo Impianto;Nome Impianto;Indirizzo;Comune;Provincia;Latitudine;Longitudine
    const stationsMap = new Map();
    for (const row of rawStations) {
      if (row.length < 10) continue;
      const id = row[0];
      stationsMap.set(id, {
        brand: row[2] || 'Independent',
        address: row[5] || '---',
        city: row[6] || '',
        lat: parseFloat(row[8]),
        lon: parseFloat(row[9])
      });
    }

    // 2. Группируем цены по заправкам
    // Структура строки цен: idImpianto;descCarburante;prezzo;isSelf
    const mergedStations = [];
    const stationsWithPrices = new Map();

    for (const row of rawPrices) {
      if (row.length < 4) continue;
      const id = row[0];
      const fuelName = row[1];
      const price = parseFloat(row[2]);
      const isSelf = row[3] === '1'; // 1 — самообслуживание (обычно дешевле), 0 — с заправщиком

      const stationInfo = stationsMap.get(id);
      if (!stationInfo || isNaN(stationInfo.lat) || isNaN(stationInfo.lon) || isNaN(price)) continue;

      // Если станции еще нет в нашем итоговом списке цен — создаем объект
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

      // Предпочитаем цены Self-Service ('1'), если они есть, так как водители ищут подешевле
      if (!currentStation.prices[fuelName] || isSelf) {
        currentStation.prices[fuelName] = {
          price: price,
          serviceType: isSelf ? 'Self' : 'Servito'
        };
      }
    }

    italyCache = Array.from(stationsWithPrices.values());
    lastFetchTime = Date.now();
    console.log(`--- [Italy API] База Италии успешно собрана. Активных АЗС с ценами: ${italyCache.length} ---`);

  } catch (error) {
    console.error('[Italy API Error] Не удалось собрать базу Италии в фоне:', error.message);
  }
};

/**
 * Инициализация фонового обновления при старте бота
 */
const initItalyUpdater = () => {
  updateItalyCache();
  setInterval(updateItalyCache, CACHE_DURATION);
};

/**
 * Поиск ближайших заправок по Италии в памяти
 */
const getItalyStations = async (lat, lon, fuelKey, radiusKm = 15) => {
  if (!italyCache) {
    await updateItalyCache();
  }

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
        horario: `Modo: ${fuelData.serviceType}`, // Передаем тип обслуживания (Self/Servito) вместо расписания
        isItaly: true
      });
    }
  }

  return result;
};

module.exports = { getItalyStations, initItalyUpdater };