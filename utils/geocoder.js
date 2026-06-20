const axios = require('axios');

// Наш локальный кэш: { "berlin": { lat: 52.52, lon: 13.40 }, "10115": {...} }
const geocodeCache = new Map();

/**
 * Получает координаты по названию города или индексу для конкретной страны
 * @param {string} input - Текст (Berlin или 10115)
 * @param {string} country - Код страны (DE, FR, ES)
 * @returns {Promise<{lat: number, lon: number, name: string}|null>}
 */
const getCoordsByText = async (input, country = 'DE') => {
  const cleanInput = input.trim().toLowerCase();
  const cacheKey = `${country}_${cleanInput}`;

  // 1. Проверяем кэш
  if (geocodeCache.has(cacheKey)) {
    console.log(`[Geocoder] Взят из кэша: ${cacheKey}`);
    return geocodeCache.get(cacheKey);
  }

  try {
    // Проверяем, является ли ввод немецким индексом (5 цифр)
    const isGermanZip = country === 'DE' && /^\d{5}$/.test(cleanInput);

    const params = {
      format: 'json',
      countrycodes: country.toLowerCase(),
      limit: 1,
      'accept-language': 'en'
    };

    if (isGermanZip) {
      params.postalcode = cleanInput;
    } else {
      params.q = cleanInput;
    }

    // Nominatim требует указывать User-Agent, чтобы не банить запросы
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params,
      headers: {
        'User-Agent': 'TelegramFuelBot/2.0 (contact: support@fuelbot.local)'
      }
    });

    if (!response.data || response.data.length === 0) {
      return null;
    }

    const result = response.data[0];
    const coords = {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      name: result.display_name.split(',')[0] // Чистое название места (город/район)
    };

    // 2. Сохраняем в кэш
    geocodeCache.set(cacheKey, coords);
    console.log(`[Geocoder] Сохранено в кэш: ${cacheKey} ->`, coords);

    return coords;

  } catch (error) {
    console.error('[Geocoder Error]:', error.message);
    return null;
  }
};

module.exports = { getCoordsByText };