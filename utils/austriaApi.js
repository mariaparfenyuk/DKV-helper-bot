const axios = require('axios');

const AUSTRIA_FUEL_MAPPING = {
  'fuel_gazole': 'DIE',
  'fuel_e10': 'SUP',
  'fuel_sp98': 'SUP',
  'fuel_gplc': 'GAS'
};

/**
 * Ищет ТОП заправок в Австрии по координатам через официальное API
 */
const getAustriaStations = async (lat, lon, fuelKey) => {
  try {
    const fuelType = AUSTRIA_FUEL_MAPPING[fuelKey] || 'DIE';
    const url = 'https://api.e-control.at/sprit/1.0/search/gas-stations/by-address';

    const response = await axios.get(url, {
      params: {
        latitude: lat,
        longitude: lon,
        fuelType: fuelType,
        // includeClosed убираем, так как API фильтрует слишком агрессивно. 
        // Мы лучше сами проверим флаг "open" в цикле.
      },
      timeout: 5000
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.log('[Austria API] Пустой ответ или не массив');
      return [];
    }

    console.log(`[Austria API] Получено станций от API: ${response.data.length}`);

    const mappedStations = response.data.map(station => {
      // Ищем нужный тип топлива в массиве цен, чтобы не надеяться на первый элемент [0]
      const priceData = station.prices ? station.prices.find(p => p.fuelType === fuelType) : null;
      const price = priceData ? priceData.amount : null;

      // Если цены нет, пропускаем АЗС
      if (!price || price <= 0) return null;

      return {
        price: price,
        name: station.name ? ` — ${station.name}` : '',
        address: station.address || '---',
        city: station.postalCode || '',
        distance: station.distance || Infinity, // Дистанция в км от API
        geom: {
          lat: station.location?.latitude,
          lon: station.location?.longitude
        },
        isOpen: station.open, // Сохраняем флаг открытости
        isAustria: true
      };
    }).filter(Boolean); // Удаляем пустые (null) результаты

    console.log(`[Austria API] Валидных станций после фильтрации: ${mappedStations.length}`);
    return mappedStations;

  } catch (error) {
    console.error('[Austria API Error]:', error.message);
    return [];
  }
};

module.exports = { getAustriaStations };